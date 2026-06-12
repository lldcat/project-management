const projectService = require('../../services/projectService');
const { enrichProject, formatMoney, formatNumber, formatPercent } = require('../../utils/metrics');
const { normalizeRoles, hasAnyRole } = require('../../services/permissionService');

function buildDisplay(metrics) {
  const m = metrics || {};
  return {
    laborBudget: formatMoney(m.laborBudget),
    travelFee: formatMoney(m.travelFee),
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

  exportCsv() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    projectService.exportCsv({})
      .then(res => this.writeCsvFile(res.csv || ''))
      .catch(err => wx.showToast({ title: err.message || '导出失败', icon: 'none' }))
      .finally(() => this.setData({ exporting: false }));
  },

  writeCsvFile(csv) {
    const fs = wx.getFileSystemManager();
    const fileName = `项目管理汇总_${this.formatDate(new Date())}.csv`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    fs.writeFile({
      filePath,
      data: csv,
      encoding: 'utf8',
      success: () => {
        wx.showModal({
          title: 'CSV已生成',
          content: `文件已生成：${fileName}。如手机无法直接打开，可先复制 CSV 内容。`,
          confirmText: '复制内容',
          cancelText: '关闭',
          success: modal => {
            if (modal.confirm) wx.setClipboardData({ data: csv });
          }
        });
      },
      fail: err => {
        console.error(err);
        wx.setClipboardData({ data: csv });
        wx.showToast({ title: '写文件失败，已复制CSV内容', icon: 'none' });
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
