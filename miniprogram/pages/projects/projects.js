const projectService = require('../../services/projectService');
const { enrichProject } = require('../../utils/metrics');

Page({
  data: {
    projects: [],
    filteredProjects: [],
    keyword: '',
    filter: 'all',
    listTitle: '我的项目',
    scopeText: 'PM 默认只显示自己创建的项目。',
    userRole: 'pm',
    canExport: true
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  loadData() {
    return projectService.listProjects({})
      .then(res => {
        const projects = (res.projects || []).map(item => {
          const project = enrichProject(item);
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
        const user = res.user || {};
        const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : ['pm'];
        const role = roles[0] || 'pm';
        const privileged = roles.indexOf('admin') >= 0 || roles.indexOf('ar') >= 0;
        const canExport = roles.some(item => ['admin', 'pm', 'sales', 'cs', 'leader', 'ar'].indexOf(item) >= 0);
        this.setData({
          projects,
          userRole: role,
          canExport,
          listTitle: privileged ? '全部项目' : '我的项目',
          scopeText: privileged ? '当前为管理视角，可查看并导出全部可见项目（不再限制固定条数）。非本人项目默认只读。' : '当前显示我创建、负责或作为组员参与的项目。'
        }, () => this.applyFilter());
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value || '' }, () => this.applyFilter());
  },

  switchFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter }, () => this.applyFilter());
  },

  applyFilter() {
    const keyword = (this.data.keyword || '').trim().toLowerCase();
    const filter = this.data.filter;
    const filteredProjects = this.data.projects.filter(item => {
      const text = [item.projectName, item.projectNo, item.customerName, item.displayPmName]
        .join(' ')
        .toLowerCase();
      const keywordOk = !keyword || text.indexOf(keyword) >= 0;
      const riskOk = filter === 'all'
        || (filter === 'risk' && item.metrics.hasRisk)
        || (filter === 'normal' && !item.metrics.hasRisk);
      return keywordOk && riskOk;
    });
    this.setData({ filteredProjects });
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
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确认删除该项目吗？',
      success: modal => {
        if (!modal.confirm) return;
        projectService.removeProject(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
          })
          .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }));
      }
    });
  },

  exportCsv() {
    projectService.exportCsv({})
      .then(res => this.writeCsvFile(res.csv || ''))
      .catch(err => wx.showToast({ title: err.message || '导出失败', icon: 'none' }));
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
