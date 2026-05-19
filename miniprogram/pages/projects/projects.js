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
    userRole: 'pm'
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
        const projects = (res.projects || []).map(enrichProject);
        const user = res.user || {};
        const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || 'pm'];
        const role = user.role || roles[0] || 'pm';
        const privileged = roles.indexOf('leader') >= 0 || roles.indexOf('admin') >= 0 || roles.indexOf('ar') >= 0;
        this.setData({
          projects,
          userRole: role,
          listTitle: privileged ? '全部项目' : '我的项目',
          scopeText: privileged ? '当前为管理视角，可查看和导出项目。非本人项目默认只读。' : '当前为 PM 视角，只显示自己创建的项目。'
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
      const text = [item.projectName, item.projectNo, item.customerName, item.projectManager]
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
