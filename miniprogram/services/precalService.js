const apiClient = require('../api/apiClient');

function callPrecalService(action, payload) {
  return apiClient.call('precalService', action, payload || {});
}

module.exports = {
  callPrecalService,
  createPrecal: payload => callPrecalService('createPrecal', payload),
  updatePrecal: payload => callPrecalService('updatePrecal', payload),
  submitPrecal: payload => callPrecalService('submitPrecal', payload),
  withdrawPrecal: payload => callPrecalService('withdrawPrecal', payload),
  getPrecalDetail: payload => callPrecalService('getPrecalDetail', payload),
  listMyPrecal: payload => callPrecalService('listMyPrecal', payload),
  listPrecalForCS: payload => callPrecalService('listPrecalForCS', payload),
  listPrecalForAdmin: payload => callPrecalService('listPrecalForAdmin', payload),
  bindSap: payload => callPrecalService('bindSap', payload),
  unlockPrecal: payload => callPrecalService('unlockPrecal', payload),
  cancelPrecal: payload => callPrecalService('cancelPrecal', payload),
  getActiveParameters: payload => callPrecalService('getActiveParameters', payload),
  updateParameters: payload => callPrecalService('updateParameters', payload)
};
