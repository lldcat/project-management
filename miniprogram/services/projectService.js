const apiClient = require('../api/apiClient');

function callProjectService(action, payload) {
  return apiClient.call('projectService', action, payload || {});
}

function listProjects(params) {
  return callProjectService('list', params || {});
}

function getDashboardOverview(params) {
  return callProjectService('dashboardOverview', params || {});
}

function getProjectDetail(id) {
  return callProjectService('detail', { id });
}

function saveProject(id, project) {
  return callProjectService('save', { id, project });
}

function removeProject(id) {
  return callProjectService('remove', { id });
}

function exportCsv(params) {
  return callProjectService('exportCsv', params || {});
}

function getExportOptions(params) {
  return callProjectService('exportOptions', params || {});
}

function exportTemplate(params) {
  return callProjectService('exportTemplate', params || {});
}

function loadPrecalBySap(sapNo) {
  return callProjectService('loadPrecalBySap', { sapNo });
}

module.exports = {
  callProjectService,
  listProjects,
  getDashboardOverview,
  getProjectDetail,
  saveProject,
  removeProject,
  exportCsv,
  getExportOptions,
  exportTemplate,
  loadPrecalBySap
};
