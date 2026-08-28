const axios = require('axios');

async function publishInstagramCarousel(imageUrls, caption, igUserId, accessToken) {
  try {
    const childContainerIds = [];
    
    // 1. 각 슬라이드별 컨테이너 생성
    for (const url of imageUrls) {
      const res = await axios.post(
        `https://graph.facebook.com/v19.0/${igUserId}/media`,
        null,
        {
          params: {
            image_url: url,
            is_carousel_item: true,
            access_token: accessToken,
          },
        }
      );
      childContainerIds.push(res.data.id);
    }

    // 2. 전체를 묶는 캐러셀 컨테이너 생성
    const carouselRes = await axios.post(
      `https://graph.facebook.com/v19.0/${igUserId}/media`,
      null,
      {
        params: {
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          caption: caption,
          access_token: accessToken,
        },
      }
    );

    // 3. 최종 인스타그램 게시
    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      null,
      {
        params: {
          creation_id: carouselRes.data.id,
          access_token: accessToken,
        },
      }
    );

    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('인스타그램 캐러셀 업로드 에러:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { publishInstagramCarousel };
