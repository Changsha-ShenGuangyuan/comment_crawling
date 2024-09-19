import gplay from 'google-play-scraper';
import appStore from 'app-store-scraper';  // 引入 app-store-scraper
import fs from 'fs';
import xlsx from 'xlsx';  // 用于生成xlsx文件
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { countries, languages } from './countries-languages.js';
import session from 'express-session';

// 获取 __dirname 的 ES 模块兼容版本
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// 设置 session 中间件
app.use(session({
  secret: 'shenguanyuan666',  // 用于签名 session ID 的密钥
  resave: false,              // 是否每次请求都重新保存 session
  saveUninitialized: true,    // 是否为未初始化的 session 保存 cookie
  cookie: { maxAge: 60000 }   // 设置 session 的有效期为 60 秒
}));

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

// 设置静态文件路径
app.use(express.static(path.join(__dirname, 'public')));

// 提交表单后，获取评论并导出
app.get('/fetch-reviews', async (req, res) => {
  const country = req.query.country || 'US';  // 获取国家
  const lang = req.query.lang || 'en';        // 获取语言
  const appId = req.query.appId || '';  // 获取应用 ID
  const rating = req.query.rating || 'all';   // 获取评分
  const platform = req.query.platform || 'android';  // 获取平台
  const filename = path.join(__dirname, `reviews_${appId}_${country}_${lang}.xlsx`);  // 定义文件名
  
  // 检查请求频率，验证不能频率过快
  if (req.session.lastFetchTime) {
    console.log('req.session.lastFetchTime:', req.session.lastFetchTime);
    const lastFetchTime = new Date(req.session.lastFetchTime);
    const currentTime = new Date();
    const timeDiff = currentTime.getTime() - lastFetchTime.getTime();  // 确保获取时间差的毫秒数
    
    console.log('timeDiff:', timeDiff);

    if (timeDiff < 5000) {  // 5 秒
      return res.status(429).send('请等待 5 秒后再试');
    }
  }

  // 验证 appId 是否有效
  const isAppIdValid = await validateAppId(appId, platform);
  if (!isAppIdValid) {
    return res.status(400).send('无效的 App ID，请重新输入');
  }

  let isReviewsSaved = false;

  // 根据平台调用不同的评论获取逻辑
  if (platform === 'android') {
    isReviewsSaved = await fetchAndroidReviews(appId, rating, country, lang, filename);
  } else if (platform === 'ios') {
    isReviewsSaved = await fetchIOSReviews(appId, rating, country, lang, filename);
  }

  if (!isReviewsSaved) {
    return res.status(400).send('没有找到任何评论，无法生成文件');
  }

  // 更新 session 中的 lastFetchTime
  req.session.lastFetchTime = new Date().toISOString();  // 存储为字符串格式

  // 成功生成文件，返回文件名
  res.json({ filename });
});

// 返回所有国家和语言的 API
app.get('/api/countries-languages', (req, res) => {
  res.json({ countries, languages });
});

// 下载生成的文件
app.get('/download', (req, res) => {
  const filename = req.query.filename;
  // 不需要再次调用 path.join
  res.download(filename, (err) => {
    if (err) {
      console.error('下载时出错:', err);
      res.status(500).send('文件下载失败');
    } else {
      // 下载完成后删除文件
      fs.unlink(filename, (unlinkErr) => {
        if (unlinkErr) {
          console.error('删除文件时发生错误:', unlinkErr);
        } else {
          console.log('文件已成功删除');
        }
      });
    }
  });
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});
