import rateLimit from 'express-rate-limit';

// 通用速率限制器
export const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15分钟
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 每15分钟最多100次请求
  message: {
    error: '请求过于频繁，请稍后再试',
    retryAfter: '15分钟'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`IP ${req.ip} 触发速率限制 - 通用限制`);
    res.status(429).json({
      error: '请求过于频繁，请15分钟后再试',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// 登录速率限制器 - 防止暴力破解
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 每15分钟最多5次登录尝试
  message: {
    error: '登录尝试过于频繁，请15分钟后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // 成功登录不计入限制
  handler: (req, res) => {
    console.log(`IP ${req.ip} 触发登录速率限制`);
    res.status(429).json({
      error: '登录尝试过于频繁，请15分钟后再试',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// 爬取功能严格限制器
export const crawlLimiter = rateLimit({
  windowMs: parseInt(process.env.CRAWL_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1小时
  max: parseInt(process.env.CRAWL_LIMIT_MAX_REQUESTS) || 5, // 每小时最多5次爬取
  message: {
    error: '爬取请求过于频繁，请1小时后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // 基于IP和用户session生成key，更精确的限制
    return `${req.ip}_${req.session.id || 'anonymous'}`;
  },
  handler: (req, res) => {
    console.log(`用户 ${req.ip} 触发爬取速率限制`);
    res.status(429).json({
      error: '爬取请求过于频繁，请1小时后再试',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// API访问限制器
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 50, // 每15分钟最多50次API请求
  message: {
    error: 'API请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false
}); 