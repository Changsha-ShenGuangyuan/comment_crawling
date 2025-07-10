// 认证中间件
const authMiddleware = (req, res, next) => {
  // 公开路径，不需要认证
  const publicPaths = ['/login', '/api/login', '/assets', '/favicon.ico'];
  
  // 检查是否是公开路径
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // 检查session中是否已认证
  if (req.session && req.session.authenticated) {
    return next();
  }

  // 未认证，重定向到登录页
  if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
    // AJAX请求返回JSON错误
    res.status(401).json({ error: '未授权访问，请先登录' });
  } else {
    // 普通请求重定向到登录页
    res.redirect('/login');
  }
};

export default authMiddleware; 