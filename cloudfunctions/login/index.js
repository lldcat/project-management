const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection('users');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return user.roles.map(String).filter(Boolean);
  if (user.role) return [String(user.role)];
  return ['pm'];
}

function uniqueRoles(records) {
  const roleMap = {};
  (records || []).forEach(item => {
    normalizeRoles(item).forEach(role => {
      if (role) roleMap[role] = true;
    });
  });
  const roles = Object.keys(roleMap);
  return roles.length ? roles : ['pm'];
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function assertAdmin(user) {
  if (!hasRole(user, 'admin')) throw new Error('只有 admin 可以维护用户角色。');
}

function sanitizeRoles(roles) {
  const allowed = { pm: true, admin: true, ar: true, member: true, sales: true, cs: true, leader: true };
  const seen = {};
  (Array.isArray(roles) ? roles : []).forEach(role => {
    const clean = normalizeText(role);
    if (allowed[clean]) seen[clean] = true;
  });
  const result = Object.keys(seen);
  return result.length ? result : ['pm'];
}

function userScore(user, openid) {
  let score = 0;
  if (user && user._id === openid) score += 1000;
  if (user && user.deleted !== true) score += 100;
  if (user && user.active !== false) score += 50;
  if (normalizeText(user && user.name)) score += 10;
  const roles = normalizeRoles(user);
  if (roles.indexOf('admin') >= 0) score += 5;
    if (roles.indexOf('sales') >= 0) score += 3;
  if (roles.indexOf('cs') >= 0) score += 2;
  return score;
}

function pickPrimaryUser(records, openid) {
  return (records || []).slice().sort((a, b) => {
    const diff = userScore(b, openid) - userScore(a, openid);
    if (diff) return diff;
    return String(a._id || '').localeCompare(String(b._id || ''));
  })[0] || null;
}

function firstDefined(records, field, fallback) {
  for (const item of records || []) {
    if (item && item[field] !== undefined && item[field] !== null && item[field] !== '') return item[field];
  }
  return fallback;
}

function buildMergedUser(primary, records, openid, now) {
  const roles = uniqueRoles(records && records.length ? records : [primary]);
  const ordered = [primary].concat((records || []).filter(item => item && item._id !== primary._id));
  return {
    _openid: openid,
    openid,
    name: normalizeText(firstDefined(ordered, 'name', '')),
    employeeName: normalizeText(firstDefined(ordered, 'employeeName', '')),
    arSheetName: normalizeText(firstDefined(ordered, 'arSheetName', '')),
    role: primary && primary.role ? primary.role : roles[0],
    roles,
    active: (records || []).some(item => item && item.active === false) ? false : true,
    defaultPersonDayCost: Number(firstDefined(ordered, 'defaultPersonDayCost', 5000)) || 5000,
    deleted: false,
    version: Number(firstDefined(ordered, 'version', 1)) || 1,
    createdAt: firstDefined(ordered, 'createdAt', now),
    updatedAt: now
  };
}

async function findUserRecords(openid) {
  const res = await users.where(_.or([{ openid }, { _openid: openid }])).limit(100).get();
  return res.data || [];
}

async function removeDuplicateUsers(records, primaryId) {
  const duplicates = (records || []).filter(item => item && item._id && item._id !== primaryId);
  await Promise.all(duplicates.map(item => users.doc(item._id).remove().catch(err => {
    console.warn('删除重复用户记录失败：', item._id, err);
  })));
  return duplicates.length;
}

async function getOrCreateCurrentUser(openid) {
  const now = db.serverDate();

  const records = await findUserRecords(openid);
  const primary = pickPrimaryUser(records, openid);

  if (primary) {
    const mergedUser = buildMergedUser(primary, records, openid, now);
    await users.doc(primary._id).update({ data: mergedUser });
    const duplicateCount = await removeDuplicateUsers(records, primary._id);
    return { user: Object.assign({ _id: primary._id }, primary, mergedUser), duplicateCount };
  }

  const newUser = buildMergedUser({ _id: openid, role: 'pm', roles: ['pm'] }, [], openid, now);

  try {
    await users.doc(openid).set({ data: newUser });
    return { user: Object.assign({ _id: openid }, newUser), duplicateCount: 0 };
  } catch (err) {
    // 极少数情况下，如果 set 失败但其他并发请求已创建用户，回查一次，避免再次 add 造成重复。
    const retryRecords = await findUserRecords(openid);
    const retryPrimary = pickPrimaryUser(retryRecords, openid);
    if (retryPrimary) {
      const mergedUser = buildMergedUser(retryPrimary, retryRecords, openid, now);
      await users.doc(retryPrimary._id).update({ data: mergedUser });
      const duplicateCount = await removeDuplicateUsers(retryRecords, retryPrimary._id);
      return { user: Object.assign({ _id: retryPrimary._id }, retryPrimary, mergedUser), duplicateCount };
    }
    throw err;
  }
}

async function updateCurrentUserName(openid, name) {
  const cleanName = normalizeText(name);
  if (!cleanName) return { ok: false, message: '姓名不能为空。' };
  const result = await getOrCreateCurrentUser(openid);
  const user = result.user || {};
  const now = db.serverDate();
  await users.doc(user._id || openid).update({
    data: {
      name: cleanName,
      updatedAt: now,
      version: _.inc(1)
    }
  });
  const refreshed = await getOrCreateCurrentUser(openid);
  return { ok: true, user: refreshed.user, duplicateCount: refreshed.duplicateCount };
}

async function listUsers(openid) {
  const current = (await getOrCreateCurrentUser(openid)).user;
  assertAdmin(current);
  const res = await users.where({ deleted: false }).orderBy('updatedAt', 'desc').limit(200).get();
  return { ok: true, user: current, users: res.data || [] };
}

async function updateUserRoles(openid, payload) {
  const current = (await getOrCreateCurrentUser(openid)).user;
  assertAdmin(current);
  const targetOpenid = normalizeText(payload && (payload.openid || payload._openid || payload.userId));
  const roles = sanitizeRoles(payload && payload.roles);
  if (!targetOpenid) return { ok: false, message: '用户 openid 不能为空。' };
  const records = await users.where(_.or([{ openid: targetOpenid }, { _openid: targetOpenid }, { _id: targetOpenid }])).limit(20).get();
  const target = pickPrimaryUser(records.data || [], targetOpenid);
  if (!target) return { ok: false, message: '用户不存在。' };
  const now = db.serverDate();
  await users.doc(target._id).update({
    data: {
      role: roles[0],
      roles,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });
  const refreshed = await users.doc(target._id).get();
  return { ok: true, user: current, targetUser: refreshed.data };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, message: '无法获取 openid，请确认云开发环境已正确初始化。' };
  }

  const action = event && event.action;
  const payload = event && event.payload || {};
  let result;
  try {
    if (action === 'updateName') result = await updateCurrentUserName(openid, payload.name);
    else if (action === 'listUsers') result = await listUsers(openid);
    else if (action === 'updateUserRoles') result = await updateUserRoles(openid, payload);
    else result = await getOrCreateCurrentUser(openid);
  } catch (err) {
    console.error(err);
    return { ok: false, message: err.message || 'login 服务异常。' };
  }

  if (result.ok === false) return result;

  return {
    ok: true,
    openid,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID || '',
    user: result.user,
    duplicateUserRecordsRemoved: result.duplicateCount
  };
};
