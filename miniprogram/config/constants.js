const USER_ROLES = {
  PM: 'pm',
  ADMIN: 'admin',
  AR: 'ar',
  MEMBER: 'member',
  SALES: 'sales',
  CS: 'cs'
};

const PRECAL_STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  WITHDRAWN: 'Withdrawn',
  SAP_BOUND: 'SAP Bound',
  PROJECT_CREATED: 'Project Created',
  UNLOCKED: 'Unlocked',
  CANCELLED: 'Cancelled'
};

const PRECAL_STATUS_LABEL = {
  Draft: '草稿',
  Submitted: '已提交',
  Withdrawn: '已撤销',
  'SAP Bound': '已绑定SAP',
  'Project Created': '已创建项目',
  Unlocked: '已解锁',
  Cancelled: '已取消'
};

const ROLE_LABEL = {
  pm: 'PM',
  admin: '系统管理员',
  ar: 'AR核对人',
  member: '普通组员',
  sales: 'Sales',
  cs: 'CS'
};

const PROJECT_CONSTANTS = {
  hoursPerDay: 8,
  defaultPersonDayCost: 5000
};

module.exports = {
  USER_ROLES,
  PRECAL_STATUS,
  PRECAL_STATUS_LABEL,
  ROLE_LABEL,
  PROJECT_CONSTANTS
};
