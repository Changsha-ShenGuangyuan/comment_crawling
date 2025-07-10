// 安全工具函数

// 验证IP是否在白名单中
export const isIPAllowed = (ip) => {
  const allowedIPs = (process.env.ALLOWED_IPS || '127.0.0.1,::1').split(',').map(ip => ip.trim());
  
  // 如果没有配置IP限制，或者包含通配符，则允许所有IP
  if (allowedIPs.includes('*') || allowedIPs.length === 0) {
    return true;
  }
  
  return allowedIPs.includes(ip);
};

// 验证密码强度
export const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码长度至少8位' };
  }
  
  return { valid: true };
};

// 生成安全的session配置
export const getSessionConfig = () => {
  return {
    secret: process.env.SESSION_SECRET || 'fallback-secret-key-change-this',
    name: 'comment.crawler.sid', // 自定义session名称
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // 生产环境使用HTTPS
      httpOnly: true, // 防止XSS攻击
      maxAge: 24 * 60 * 60 * 1000, // 24小时
      sameSite: 'strict' // 防止CSRF攻击
    }
  };
};

// 日志记录函数
export const logSecurityEvent = (event, ip, details = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[SECURITY] ${timestamp} - ${event} - IP: ${ip}`, details);
};

// 清理输入数据，防止XSS
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/[<>]/g, '') // 移除尖括号
    .trim()
    .substring(0, 1000); // 限制长度
}; 