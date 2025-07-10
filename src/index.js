import gplay from 'google-play-scraper';
import appStore from 'app-store-scraper';  // 引入 app-store-scraper
import fs from 'fs';
import xlsx from 'xlsx';  // 用于生成xlsx文件
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { countries, languages } from './countries-languages.js';
import session from 'express-session';
import dotenv from 'dotenv';
import authMiddleware from './auth-middleware.js';
import { generalLimiter, loginLimiter, crawlLimiter, apiLimiter } from './rate-limiter.js';
import { isIPAllowed, getSessionConfig, logSecurityEvent, sanitizeInput } from './security-utils.js';

// 加载环境变量
dotenv.config();

// 获取基础路径
const BASE_PATH = process.env.BASE_PATH || '';

// 获取 __dirname 的 ES 模块兼容版本
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 信任代理，获取真实IP
app.set('trust proxy', 1);

// 解析表单数据
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 应用通用速率限制
app.use(generalLimiter);

// 设置 session 中间件（使用安全配置）
app.use(session(getSessionConfig()));

// IP访问控制（可选）
app.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!isIPAllowed(clientIp)) {
    logSecurityEvent('IP_BLOCKED', clientIp);
    return res.status(403).json({ error: '访问被拒绝：IP不在允许列表中' });
  }
  
  next();
});

// 应用认证中间件
app.use(authMiddleware);

// 保存评论到 xlsx 文件，只包含所需的列，并调整 text 字段的长度
const saveToXLSX = (reviews, filename) => {
  try {
    // 筛选所需的列
    const filteredReviews = reviews.map(review => ({
      userName: review.userName || review.user,  // 根据平台不同，选择适当字段
      date: review.date || review.updated,  // 根据平台不同，选择适当字段
      score: review.score || review.rating,  // 根据平台不同，选择适当字段
      text: review.text || review.review,  // 根据平台不同，选择适当字段
    }));

    // 定义要保存的字段
    const worksheet = xlsx.utils.json_to_sheet(filteredReviews);  // 将 JSON 转换为 Excel 工作表
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Reviews');

    // 调整 text 列宽，确保足够显示较长的文本
    worksheet['!cols'] = [
      { wch: 20 },  // userName 列宽度
      { wch: 30 },  // date 列宽度
      { wch: 10 },   // score 列宽度
      { wch: 300 }   // text 列宽度，增加以显示较长文本
    ];

    // 将 xlsx 文件写入
    xlsx.writeFile(workbook, filename);
    console.log(`评论已保存到 ${filename}`);
  } catch (err) {
    console.error('保存 xlsx 文件时发生错误:', err);
  }
};

// 验证 appId 是否有效
const validateAppId = async (appId, platform) => {
  try {
    if (platform === 'android') {
      await gplay.app({ appId });  // 尝试获取应用信息（Android）
    } else if (platform === 'ios') {
      await appStore.app({ id: appId });  // 尝试获取应用信息（iOS）
    }
    return true;  // 如果成功，appId 是有效的
  } catch (err) {
    console.log('err', err);
    console.error(`无效的 appId: ${appId}`);
    return false;  // 如果出错，appId 是无效的
  }
};

// 获取 Google Play 评论
const fetchAndroidReviews = async (appId, rating, country, lang, filename) => {
  let allReviews = [];
  let nextPaginationToken = null;
  let pageIndex = 1;

  try {
    do {
      const options = {
        appId: appId,
        // sort: gplay.sort.RATING,  // 按评分排序
        // 按最近评论排序
        sort: gplay.sort.NEWEST,
        nextPaginationToken: nextPaginationToken,
        country: country,
        lang: lang
      };

      const reviewsResponse = await gplay.reviews(options);
      const reviews = reviewsResponse.data;

      // 如果需要按评分过滤，则进行本地筛选
      if (rating !== 'all') {
        const ratingInt = parseInt(rating);  // 将 rating 转换为整数
        const filteredReviews = reviews.filter(review => review.score === ratingInt);
        allReviews = allReviews.concat(filteredReviews);
      } else {
        allReviews = allReviews.concat(reviews);  // 不筛选，获取所有评分的评论
      }

      console.log(`第 ${pageIndex} 页评论获取成功，评论数量：${reviews.length}`);
      nextPaginationToken = reviewsResponse.nextPaginationToken;
      // 最多获取200页评论
      if (pageIndex >= 200) {
        nextPaginationToken = null;
      }
      pageIndex++;

    } while (nextPaginationToken);  // 如果有下一页继续请求

    // 如果没有评论，返回 false
    if (allReviews.length === 0) {
      return false;
    }

    // 保存所有评论为 xlsx 文件
    saveToXLSX(allReviews, filename);
    return true;

  } catch (err) {
    console.error('获取评论时发生错误:', err);
    return false;
  }
};

// 获取 App Store 评论
const fetchIOSReviews = async (appId, rating, country, lang, filename) => {
  let allReviews = [];
  let pageIndex = 1;

  try {
    let hasMoreReviews = true;

    // 循环获取每一页的评论，直到没有更多评论
    while (hasMoreReviews) {
      const reviewsResponse = await appStore.reviews({
        id: appId,  // iOS 应用的 App Store ID
        sort: appStore.sort.RECENT,  // 排序方式：最新评论
        country: country,  // 国家代码
        page: pageIndex  // 当前页数
      });

      const reviews = reviewsResponse;

      // 如果需要按评分过滤
      if (rating !== 'all') {
        const ratingInt = parseInt(rating);

        allReviews = allReviews.concat(reviews.filter(review => review.score === ratingInt));
      } else {
        allReviews = allReviews.concat(reviews);
      }

      console.log(`第 ${pageIndex} 页评论获取成功，评论数量：${reviews.length}`);

      // 如果当前页没有更多评论，退出循环
      if (reviews.length === 0) {
        hasMoreReviews = false;
      } else {
        // 最多获取 10 页评论
        if (pageIndex >= 10) {
          hasMoreReviews = false;
        } else {
          pageIndex++;  // 否则，继续请求下一页
        }  
      }
    }

    if (allReviews.length === 0) {
      return false;
    }

    // 保存所有评论为 xlsx 文件
    saveToXLSX(allReviews, filename);
    return true;

  } catch (err) {
    console.error('获取 iOS 评论时发生错误:', err);
    return false;
  }
};

// 静态文件服务加BASE_PATH前缀
app.use(`${BASE_PATH}`, express.static(path.join(__dirname, 'public')));

// 如果设置了BASE_PATH，根路径返回404
if (BASE_PATH) {
  app.get('/', (req, res) => {
    res.status(404).send('Not Found');
  });
}

// 登录页面
app.get(`${BASE_PATH}/login`, (req, res) => {
  if (req.session.authenticated) {
    return res.redirect(`${BASE_PATH}/`);
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>评论爬取工具 - 安全登录</title>
      <link href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
        .login-container { margin-top: 10vh; }
        .card { border: none; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
        .card-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 15px 15px 0 0; }
        .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; }
        .alert { border-radius: 10px; }
      </style>
      <script>
        window.BASE_PATH = '${BASE_PATH}';
      </script>
    </head>
    <body>
      <div class="container login-container">
        <div class="row justify-content-center">
          <div class="col-md-6">
            <div class="card">
              <div class="card-header text-center py-4">
                <h3><i class="fas fa-shield-alt"></i> 安全认证</h3>
                <p class="mb-0">评论爬取工具访问验证</p>
              </div>
              <div class="card-body p-4">
                <div id="error-alert" class="alert alert-danger" style="display: none;"></div>
                <form id="loginForm">
                  <div class="form-group">
                    <label for="password"><i class="fas fa-key"></i> 访问密码</label>
                    <input type="password" class="form-control" id="password" name="password" 
                           placeholder="请输入访问密码" required>
                  </div>
                  <button type="submit" class="btn btn-primary btn-block py-2">
                    <i class="fas fa-sign-in-alt"></i> 登录
                  </button>
                </form>
                <hr>
                <div class="text-center text-muted">
                  <small>
                    <i class="fas fa-info-circle"></i> 
                    此工具仅供授权用户使用
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
     
      <script>
        $('#loginForm').on('submit', function(e) {
          e.preventDefault();
          const password = $('#password').val();
          const errorAlert = $('#error-alert');
          const basePath = window.BASE_PATH || '';
          $.post(basePath + '/api/login', { password: password })
            .done(function() {
              window.location.href = basePath + '/';
            })
            .fail(function(xhr) {
              const response = xhr.responseJSON || { error: '登录失败' };
              errorAlert.text(response.error).show();
              setTimeout(() => errorAlert.fadeOut(), 5000);
            });
        });
      </script>
    </body>
    </html>
  `);
});

// 登录API
app.post(`${BASE_PATH}/api/login`, loginLimiter, (req, res) => {
  const { password } = req.body;
  const clientIp = req.ip;
  
  // 清理输入
  const cleanPassword = sanitizeInput(password);
  
  if (!cleanPassword) {
    logSecurityEvent('LOGIN_EMPTY_PASSWORD', clientIp);
    return res.status(400).json({ error: '请输入密码' });
  }
  
  const adminPassword = process.env.ADMIN_PASSWORD;
  // console.log('adminPassword', adminPassword);
  if (!adminPassword) {
    logSecurityEvent('LOGIN_NO_ADMIN_PASSWORD', clientIp);
    return res.status(500).json({ error: '服务器配置错误' });
  }
  // console.log('cleanPassword', cleanPassword);
  if (cleanPassword === adminPassword) {
    req.session.authenticated = true;
    req.session.loginTime = new Date().toISOString();
    req.session.userIP = clientIp;
    
    logSecurityEvent('LOGIN_SUCCESS', clientIp);
    res.json({ success: true, message: '登录成功' });
  } else {
    logSecurityEvent('LOGIN_FAILED', clientIp, { reason: 'wrong_password' });
    res.status(401).json({ error: '密码错误，请重试' });
  }
});

// 退出登录
app.get(`${BASE_PATH}/logout`, (req, res) => {
  const clientIp = req.ip;
  logSecurityEvent('LOGOUT', clientIp);
  
  req.session.destroy((err) => {
    if (err) {
      console.error('销毁session失败:', err);
    }
    res.redirect(`${BASE_PATH}/login`);
  });
});

// 系统状态API（仅限已登录用户）
app.get(`${BASE_PATH}/api/status`, apiLimiter, (req, res) => {
  res.json({
    status: 'online',
    authenticated: true,
    loginTime: req.session.loginTime,
    userIP: req.session.userIP,
    serverTime: new Date().toISOString()
  });
});

// 提交表单后，获取评论并导出（应用爬取限制）
app.get(`${BASE_PATH}/fetch-reviews`, crawlLimiter, async (req, res) => {
  const clientIp = req.ip;
  
  // 清理和验证输入参数
  const country = sanitizeInput(req.query.country) || 'US';
  const lang = sanitizeInput(req.query.lang) || 'en';
  const appId = sanitizeInput(req.query.appId) || '';
  const rating = sanitizeInput(req.query.rating) || 'all';
  const platform = sanitizeInput(req.query.platform) || 'android';
  
  // 验证必要参数
  if (!appId) {
    logSecurityEvent('FETCH_INVALID_APPID', clientIp, { appId });
    return res.status(400).json({ error: '请提供有效的应用ID' });
  }
  
  // 验证平台参数
  if (!['android', 'ios'].includes(platform)) {
    logSecurityEvent('FETCH_INVALID_PLATFORM', clientIp, { platform });
    return res.status(400).json({ error: '无效的平台参数' });
  }
  
  // 记录爬取请求
  logSecurityEvent('FETCH_REQUEST', clientIp, { 
    appId, 
    platform, 
    country, 
    lang, 
    rating,
    userSession: req.session.id 
  });
  
  const filename = path.join(__dirname, `reviews_${appId}_${country}_${lang}_${Date.now()}.xlsx`);
  
  // 检查session中的请求频率（额外保护）
  if (req.session.lastFetchTime) {
    const lastFetchTime = new Date(req.session.lastFetchTime);
    const currentTime = new Date();
    const timeDiff = currentTime.getTime() - lastFetchTime.getTime();
    
    if (timeDiff < 10000) {  // 10 秒内不允许重复请求
      logSecurityEvent('FETCH_TOO_FREQUENT', clientIp, { timeDiff });
      return res.status(429).json({ 
        error: '请求过于频繁，请等待10秒后再试',
        retryAfter: Math.ceil((10000 - timeDiff) / 1000)
      });
    }
  }

  try {
    // 验证 appId 是否有效
    const isAppIdValid = await validateAppId(appId, platform);
    if (!isAppIdValid) {
      logSecurityEvent('FETCH_INVALID_APPID_VALIDATION', clientIp, { appId, platform });
      return res.status(400).json({ error: '无效的 App ID，请检查并重新输入' });
    }

    let isReviewsSaved = false;

    // 根据平台调用不同的评论获取逻辑
    if (platform === 'android') {
      isReviewsSaved = await fetchAndroidReviews(appId, rating, country, lang, filename);
    } else if (platform === 'ios') {
      isReviewsSaved = await fetchIOSReviews(appId, rating, country, lang, filename);
    }

    if (!isReviewsSaved) {
      logSecurityEvent('FETCH_NO_REVIEWS', clientIp, { appId, platform });
      return res.status(400).json({ error: '没有找到任何评论，无法生成文件' });
    }

    // 更新 session 中的 lastFetchTime
    req.session.lastFetchTime = new Date().toISOString();

    // 记录成功的爬取
    logSecurityEvent('FETCH_SUCCESS', clientIp, { 
      appId, 
      platform, 
      filename: path.basename(filename) 
    });

    // 成功生成文件，返回文件名
    res.json({ 
      success: true, 
      filename: path.basename(filename),
      message: '评论爬取成功'
    });
    
  } catch (error) {
    logSecurityEvent('FETCH_ERROR', clientIp, { 
      appId, 
      platform, 
      error: error.message 
    });
    
    console.error('爬取评论时发生错误:', error);
    res.status(500).json({ 
      error: '服务器内部错误，请稍后重试' 
    });
  }
});

// 返回所有国家和语言的 API
app.get(`${BASE_PATH}/api/countries-languages`, apiLimiter, (req, res) => {
  res.json({ countries, languages });
});

// 下载生成的文件
app.get(`${BASE_PATH}/download`, (req, res) => {
  const requestedFilename = sanitizeInput(req.query.filename);
  const clientIp = req.ip;
  
  if (!requestedFilename) {
    logSecurityEvent('DOWNLOAD_NO_FILENAME', clientIp);
    return res.status(400).json({ error: '文件名不能为空' });
  }
  
  // 安全检查：只允许下载xlsx文件，且文件名必须包含reviews前缀
  if (!requestedFilename.startsWith('reviews_') || !requestedFilename.endsWith('.xlsx')) {
    logSecurityEvent('DOWNLOAD_INVALID_FILENAME', clientIp, { filename: requestedFilename });
    return res.status(400).json({ error: '无效的文件名' });
  }
  
  const fullPath = path.join(__dirname, requestedFilename);
  
  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    logSecurityEvent('DOWNLOAD_FILE_NOT_FOUND', clientIp, { filename: requestedFilename });
    return res.status(404).json({ error: '文件不存在' });
  }
  
  // 记录下载事件
  logSecurityEvent('DOWNLOAD_START', clientIp, { filename: requestedFilename });
  
  res.download(fullPath, requestedFilename, (err) => {
    if (err) {
      logSecurityEvent('DOWNLOAD_ERROR', clientIp, { 
        filename: requestedFilename, 
        error: err.message 
      });
      console.error('下载时出错:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '文件下载失败' });
      }
    } else {
      logSecurityEvent('DOWNLOAD_SUCCESS', clientIp, { filename: requestedFilename });
      
      // 下载完成后删除文件
      fs.unlink(fullPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('删除文件时发生错误:', unlinkErr);
        } else {
          console.log(`文件已成功删除: ${requestedFilename}`);
        }
      });
    }
  });
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});
