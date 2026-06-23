const projectService = require('../../services/projectService');
const { enrichProject, formatMoney, formatNumber, formatPercent } = require('../../utils/metrics');
const { normalizeRoles, hasAnyRole } = require('../../services/permissionService');

function buildDisplay(metrics) {
  const m = metrics || {};
  const metricNumber = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const projectBudgetWithTravel = m.projectBudgetWithTravel === null || m.projectBudgetWithTravel === undefined
    ? (metricNumber(m.bac) + metricNumber(m.travelFee))
    : m.projectBudgetWithTravel;
  return {
    laborBudget: formatMoney(m.laborBudget),
    travelFee: formatMoney(m.travelFee),
    projectBudgetWithTravel: formatMoney(projectBudgetWithTravel),
    bac: formatMoney(m.bac),
    plannedValue: formatMoney(m.plannedValue),
    earnedValue: formatMoney(m.earnedValue),
    actualCost: formatMoney(m.actualCost),
    costVariance: formatMoney(m.costVariance),
    scheduleVariance: formatMoney(m.scheduleVariance),
    cpi: formatNumber(m.costPerformanceIndex),
    spi: formatNumber(m.schedulePerformanceIndex),
    plannedCompletionRatio: formatPercent(m.plannedCompletionRatio),
    actualCompletionRatio: formatPercent(m.actualCompletionRatio),
    sumBudgetHours: formatNumber(m.sumBudgetHours),
    sumPlannedHours: formatNumber(m.sumPlannedHours),
    sumArHours: formatNumber(m.sumArHours),
    sumEmployeeBudgetHours: formatNumber(m.sumEmployeeBudgetHours),
    budgetAllocationDiff: formatNumber(m.budgetAllocationDiff),
    budgetAllocationRatio: formatPercent(m.budgetAllocationRatio)
  };
}

function normalizeProjectRow(item) {
  if (item && item.metrics) {
    return Object.assign({}, item, { display: buildDisplay(item.metrics) });
  }
  return enrichProject(item);
}

function buildPmOptions(pmNames, selectedPmNames) {
  const selectedMap = {};
  (selectedPmNames || []).forEach(name => { selectedMap[name] = true; });
  return (pmNames || []).map(name => ({
    name,
    checked: !!selectedMap[name]
  }));
}

Page({
  data: {
    projects: [],
    filteredProjects: [],
    keyword: '',
    filter: 'all',
    listTitle: '我的项目',
    scopeText: 'PM 默认只显示自己创建的项目。',
    userRole: 'pm',
    canExport: true,
    loading: false,
    loadingMore: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
    total: 0,
    exporting: false,
    exportPanelVisible: false,
    exportStatusIndex: 0,
    exportStatusOptions: [
      { label: '全部项目', value: 'all' },
      { label: '已完结项目', value: 'completed' },
      { label: '进行中项目', value: 'active' }
    ],
    exportFilters: {
      status: 'all',
      customerName: '',
      projectName: '',
      sapNo: '',
      createdStart: '',
      createdEnd: '',
      closedStart: '',
      closedEnd: ''
    },
    exportPmOptions: [],
    selectedPmNames: [],
    selectedPmText: '全部可见 PM',
    exportPmOptionsText: '',
    deletingId: ''
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData({ reset: true }).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  loadData(options) {
    const opts = options || {};
    const reset = opts.reset !== false;
    if (this.data.loading || this.data.loadingMore) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, page: 1 } : { loadingMore: true });
    return projectService.listProjects({
      page,
      pageSize: this.data.pageSize,
      keyword: this.data.keyword,
      filter: this.data.filter
    })
      .then(res => {
        const rows = (res.projects || []).map(item => {
          const project = normalizeProjectRow(item);
          const myAllocation = project._myAllocation || {};
          const hasMyBudget = myAllocation.hasBudgetHours || myAllocation.budgetHours !== '';
          project.displayPmName = project.pmName || project.projectManager || '-';
          project.projectNameText = project.projectName || '未命名项目';
          project.projectNoText = project.projectNo || '无项目号';
          project.customerNameText = project.customerName || '无客户名称';
          project.riskTagText = project.metrics.hasRisk ? '风险' : '正常';
          project.riskTagClass = project.metrics.hasRisk ? 'tag-risk' : 'tag-normal';
          project.showMyAllocation = project._isProjectMember && !project._canViewFullProject;
          project.myAllocationText = hasMyBudget ? `${myAllocation.budgetHours} h` : '未分配';
          return project;
        });
        const projects = reset ? rows : this.data.projects.concat(rows);
        const user = res.user || {};
        const roles = normalizeRoles(user);
        const role = roles[0] || 'pm';
        const privileged = hasAnyRole({ roles }, ['admin', 'ar']);
        const canExport = hasAnyRole({ roles }, ['admin', 'pm', 'sales', 'cs', 'leader', 'ar']);
        this.setData({
          projects,
          filteredProjects: projects,
          userRole: role,
          canExport,
          page: res.page || page,
          pageSize: res.pageSize || this.data.pageSize,
          hasMore: !!res.hasMore,
          total: Number(res.total || 0),
          listTitle: privileged ? '全部项目' : '我的项目',
          scopeText: privileged ? '当前为管理视角，列表按页加载；非本人项目默认只读。' : '当前显示我创建、负责或作为组员参与的项目。'
        });
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => {
        this.setData(reset ? { loading: false } : { loadingMore: false });
      });
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.loadData({ reset: false });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value || '' });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadData({ reset: true }), 300);
  },

  switchFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter }, () => this.loadData({ reset: true }));
  },

  applyFilter() {
    this.setData({ filteredProjects: this.data.projects });
  },

  createProject() {
    wx.navigateTo({ url: '/pages/edit/edit' });
  },

  editProject(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/edit/edit?id=${id}` });
  },

  deleteProject(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.deletingId) return;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确认删除该项目吗？',
      success: modal => {
        if (!modal.confirm) return;
        this.setData({ deletingId: id });
        projectService.removeProject(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData({ reset: true });
          })
          .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))
          .finally(() => this.setData({ deletingId: '' }));
      }
    });
  },

  toggleExportPanel() {
    const nextVisible = !this.data.exportPanelVisible;
    this.setData({ exportPanelVisible: nextVisible });
    if (nextVisible && !this.data.exportPmOptions.length) this.loadExportOptions();
  },

  loadExportOptions() {
    projectService.getExportOptions({})
      .then(res => {
        console.log('[project export] cloud function version:', res.exportServiceVersion || 'unknown', res.exportRuntimeHint || '');
        const pmNames = res.pmNames || [];
        const selectedMap = {};
        this.data.selectedPmNames.forEach(name => { selectedMap[name] = true; });
        const selectedPmNames = pmNames.filter(name => selectedMap[name]);
        this.setData({
          exportPmOptions: buildPmOptions(pmNames, selectedPmNames),
          selectedPmNames,
          selectedPmText: selectedPmNames.length ? `已选择 ${selectedPmNames.length} 个 PM` : '全部可见 PM',
          exportPmOptionsText: pmNames.length ? '' : '暂无可选 PM'
        });
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: err.message || '导出选项加载失败', icon: 'none' });
      });
  },

  onExportStatusChange(e) {
    const index = Number(e.detail.value);
    const option = this.data.exportStatusOptions[index] || this.data.exportStatusOptions[0];
    this.setData({
      exportStatusIndex: index,
      'exportFilters.status': option.value
    });
  },

  onExportFilterInput(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data[`exportFilters.${field}`] = e.detail.value || '';
    this.setData(data);
  },

  onPmCheckboxChange(e) {
    const selectedPmNames = e.detail.value || [];
    this.setData({
      selectedPmNames,
      exportPmOptions: buildPmOptions(this.data.exportPmOptions.map(item => item.name), selectedPmNames),
      selectedPmText: selectedPmNames.length ? `已选择 ${selectedPmNames.length} 个 PM` : '全部可见 PM'
    });
  },

  onExportDateChange(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data[`exportFilters.${field}`] = e.detail.value || '';
    this.setData(data);
  },

  resetExportFilters() {
    this.setData({
      exportStatusIndex: 0,
      selectedPmNames: [],
      selectedPmText: '全部可见 PM',
      exportPmOptions: buildPmOptions(this.data.exportPmOptions.map(item => item.name), []),
      exportFilters: {
        status: 'all',
        customerName: '',
        projectName: '',
        sapNo: '',
        createdStart: '',
        createdEnd: '',
        closedStart: '',
        closedEnd: ''
      }
    });
  },

  buildExportPayload() {
    const filters = this.data.exportFilters || {};
    return {
      status: filters.status || 'all',
      pmNames: this.data.selectedPmNames || [],
      customerName: filters.customerName || '',
      projectName: filters.projectName || '',
      sapNo: filters.sapNo || '',
      createdStart: filters.createdStart || '',
      createdEnd: filters.createdEnd || '',
      closedStart: filters.closedStart || '',
      closedEnd: filters.closedEnd || ''
    };
  },

  exportTemplate() {
    if (this.data.exporting) return;
    const selectedCount = (this.data.selectedPmNames || []).length;
    if (!selectedCount) {
      wx.showToast({ title: '请先勾选一个 PM 测试导出', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认导出',
      content: `将按原 Excel 模板导出已选择的 ${selectedCount} 个 PM。项目较多时可能需要等待一会儿。`,
      confirmText: '开始导出',
      cancelText: '取消',
      success: modal => {
        if (modal.confirm) this.doExportTemplate();
      }
    });
  },

  doExportTemplate() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '生成中' });
    projectService.exportTemplate({
      filters: this.buildExportPayload(),
      delivery: 'base64',
      skipArTime: false
    })
      .then(res => {
        wx.hideLoading();
        this.handleExportResult(res);
      })
      .catch(err => {
        wx.hideLoading();
        const message = err && err.message || '';
        const title = message.indexOf('FUNCTIONS_TIME_LIMIT_EXCEEDED') >= 0 || message.indexOf('timed out') >= 0
          ? '导出超时，请重新部署云函数配置'
          : (message || '导出失败');
        wx.showToast({ title, icon: 'none' });
      })
      .finally(() => this.setData({ exporting: false }));
  },

  handleExportResult(res) {
    if (res && res.fileBase64) {
      this.writeBase64ExportFile(res);
      return;
    }
    if (!res || !res.fileID) {
      wx.showToast({ title: (res && res.message) || '导出失败', icon: 'none' });
      return;
    }
    const fileName = res.fileName || '项目导出.xlsx';
    const isZip = /\.zip$/i.test(fileName);
    const content = `已生成 ${fileName}\n项目数：${res.projectCount || 0}\nPM数：${res.pmCount || 0}`;
    if (isZip) {
      wx.showModal({
        title: '导出已生成',
        content: `${content}\n小程序可能无法直接预览 zip，可复制下载链接到浏览器下载。`,
        confirmText: '复制链接',
        cancelText: '关闭',
        success: modal => {
          if (modal.confirm) wx.setClipboardData({ data: res.downloadUrl || res.fileID });
        }
      });
      return;
    }
    wx.showModal({
      title: '导出已生成',
      content,
      confirmText: '打开文件',
      cancelText: '复制链接',
      success: modal => {
        if (modal.confirm) {
          this.openCloudFile(res.fileID, fileName);
        } else {
          wx.setClipboardData({ data: res.downloadUrl || res.fileID });
        }
      }
    });
  },

  writeBase64ExportFile(res) {
    const fileName = res.fileName || '项目导出.xlsx';
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    const arrayBuffer = wx.base64ToArrayBuffer(res.fileBase64);
    wx.getFileSystemManager().writeFile({
      filePath,
      data: arrayBuffer,
      success: () => {
        const isZip = /\.zip$/i.test(fileName);
        const content = `已生成 ${fileName}\n项目数：${res.projectCount || 0}\nPM数：${res.pmCount || 0}`;
        if (isZip) {
          wx.showModal({
            title: '导出已生成',
            content: `${content}\nzip 已保存到小程序临时目录，可通过开发者工具文件系统查看。`,
            showCancel: false
          });
          return;
        }
        wx.openDocument({
          filePath,
          fileType: 'xlsx',
          showMenu: true,
          fail: () => wx.showModal({
            title: '导出已生成',
            content: `${content}\n文件已保存，但当前环境打开失败。`,
            showCancel: false
          })
        });
      },
      fail: err => {
        console.error(err);
        wx.showToast({ title: '写入导出文件失败', icon: 'none' });
      }
    });
  },

  openCloudFile(fileID, fileName) {
    wx.cloud.downloadFile({
      fileID,
      success: downloadRes => {
        wx.openDocument({
          filePath: downloadRes.tempFilePath,
          fileType: 'xlsx',
          showMenu: true,
          fail: () => wx.showToast({ title: `${fileName} 已下载，打开失败`, icon: 'none' })
        });
      },
      fail: err => {
        console.error(err);
        wx.showToast({ title: '文件下载失败', icon: 'none' });
      }
    });
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}_${hh}${mm}`;
  }
});
