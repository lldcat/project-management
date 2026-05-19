const apiClient = require('../api/apiClient');

function callProjectService(action, payload) {
  return apiClient.call('projectService', action, payload || {});
}

function listProjects(params) {
  return callProjectService('list', params || {});
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

module.exports = {
  callProjectService,
  listProjects,
  getProjectDetail,
  saveProject,
  removeProject,
  exportCsv
};
