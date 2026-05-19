const projectService = require('../services/projectService');
const precalService = require('../services/precalService');

module.exports = {
  callProjectService: projectService.callProjectService,
  callPrecalService: precalService.callPrecalService
};
