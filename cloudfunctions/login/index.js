const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection('users');
const DEFAULT_ROLES = ['pm', 'sales'];
const ALLOWED_ROLE_MAP = { admin: true, pm: true, sales: true, cs: true, ar: true, leader: true, member: true };

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRoles(user) {
  const seen = {};
  const result = [];
  const add = role => {
    const clean = normalizeText(role);
    if (ALLOWED_ROLE_MAP[clean] && !seen[clean]) {
      seen[clean] = true;
      result.push(clean);
    }
  };
  if (user && Array.isArray(user.roles) && user.roles.length) user.roles.forEach(add);
  if (!result.length) DEFAULT_ROLES.forEach(add);
  return result;
}

function uniqueRoles(records) {
  const roleMap = {};
  (records || []).forEach(item => {
    normalizeRoles(item).forEach(role => {
      if (role) roleMap[role] = true;
    });
  });
  const roles = Object.keys(roleMap);
  return roles.length ? roles : DEFAULT_ROLES.slice();
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function assertAdmin(user) {
  if (!hasRole(user, 'admin')) throw new Error('只有 admin 可以维护用户角色。');
}

function isVisibleUser(user) {
  return user && user.deleted !== true;
}

function publicUserForAdmin(user) {
  return {
    _id: user._id,
    name: normalizeText(user.name),
    roles: normalizeRoles(user),
    active: user.active === false ? false : true,
    createdAt: user.createdAt || '',
    updatedAt: user.updatedAt || ''
  };
}

function sanitizeRoles(roles) {
  const seen = {};
  (Array.isArray(roles) ? roles : []).forEach(role => {
    const clean = normalizeText(role);
    if (ALLOWED_ROLE_MAP[clean]) seen[clean] = true;
  });
  const result = Object.keys(seen);
  return result.length ? result : DEFAULT_ROLES.slice();
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

function buildMergedUser(primary, openid, now) {
  const roles = uniqueRoles([primary]);
  return {
    openid,
    name: normalizeText(primary && primary.name),
    arSheetName: normalizeText(primary && primary.arSheetName),
    roles,
    active: primary && primary.active === false ? false : true,
    deleted: false,
    version: Number(primary && primary.version || 1) || 1,
    createdAt: primary && primary.createdAt || now,
    updatedAt: now
  };
}

async function findUserRecords(openid) {
  const fetchByQuery = async query => {
    const rows = [];
    let skip = 0;
    const pageSize = 100;
    while (true) {
      const res = await users.where(query).skip(skip).limit(pageSize).get();
      const batch = res.data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
    return rows;
  };
  const byOpenid = await fetchByQuery({ openid });
  const bySystemOpenid = await fetchByQuery({ _openid: openid });
  let byDocId = null;
  try {
    const doc = await users.doc(openid).get();
    byDocId = doc && doc.data;
  } catch (err) {}
  const seen = {};
  return []
    .concat(byDocId ? [byDocId] : [])
    .concat(byOpenid)
    .concat(bySystemOpenid)
    .filter(item => {
      const key = item && item._id;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

async function removeDuplicateUsers(records, primaryId) {
  const duplicates = (records || []).filter(item => item && item._id && item._id !== primaryId);
  const now = db.serverDate();
  await Promise.all(duplicates.map(item => users.doc(item._id).update({
    data: {
      deleted: true,
      active: false,
      duplicateOf: primaryId,
      duplicateArchivedAt: now,
      updatedAt: now,
      version: _.inc(1)
    }
  }).catch(err => {
    console.warn('标记重复用户记录失败：', item._id, err);
  })));
  return duplicates.length;
}

async function getOrCreateCurrentUser(openid) {
  const now = db.serverDate();

  const records = await findUserRecords(openid);
  const primary = pickPrimaryUser(records, openid);

  if (primary) {
    const mergedUser = buildMergedUser(primary, openid, now);
    await users.doc(primary._id).update({ data: mergedUser });
    const duplicateCount = await removeDuplicateUsers(records, primary._id);
    return { user: Object.assign({ _id: primary._id }, primary, mergedUser), duplicateCount };
  }

  const newUser = buildMergedUser({ _id: openid, roles: DEFAULT_ROLES }, openid, now);

  try {
    await users.doc(openid).set({ data: newUser });
    return { user: Object.assign({ _id: openid }, newUser), duplicateCount: 0 };
  } catch (err) {
    // 极少数情况下，如果 set 失败但其他并发请求已创建用户，回查一次，避免再次 add 造成重复。
    const retryRecords = await findUserRecords(openid);
    const retryPrimary = pickPrimaryUser(retryRecords, openid);
    if (retryPrimary) {
      const mergedUser = buildMergedUser(retryPrimary, openid, now);
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

async function listUsers(openid, payload) {
  const current = (await getOrCreateCurrentUser(openid)).user;
  assertAdmin(current);
  const allUsers = [];
  const pageSize = 100;
  let skip = 0;
  while (true) {
    const res = await users.skip(skip).limit(pageSize).get();
    const rows = res.data || [];
    allUsers.push.apply(allUsers, rows);
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  const visibleUsers = allUsers
    .filter(isVisibleUser)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(publicUserForAdmin);
  return { ok: true, user: current, users: visibleUsers };
}

async function updateUserRoles(openid, payload) {
  const current = (await getOrCreateCurrentUser(openid)).user;
  assertAdmin(current);
  const targetUserId = normalizeText(payload && payload.userId);
  const roles = sanitizeRoles(payload && payload.roles);
  if (!targetUserId) return { ok: false, message: '用户 ID 不能为空。' };
  const targetRes = await users.doc(targetUserId).get();
  const target = targetRes && targetRes.data;
  if (!target || target.deleted === true) return { ok: false, message: '用户不存在。' };
  const now = db.serverDate();
  await users.doc(targetUserId).update({
    data: {
      roles,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });
  const refreshed = await users.doc(targetUserId).get();
  return { ok: true, user: current, targetUser: publicUserForAdmin(refreshed.data || {}) };
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
    else if (action === 'listUsers') result = await listUsers(openid, payload);
    else if (action === 'updateUserRoles') result = await updateUserRoles(openid, payload);
    else result = await getOrCreateCurrentUser(openid);
  } catch (err) {
    console.error(err);
    return { ok: false, message: err.message || 'login 服务异常。' };
  }

  if (result.ok === false) return result;

  return Object.assign({}, result, {
    ok: true,
    openid,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID || '',
    user: result.user,
    duplicateUserRecordsRemoved: result.duplicateCount
  });
};
