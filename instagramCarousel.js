const axios = require('axios');

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 미디어 컨테이너 상태 폴링 (준비 완료될 때까지 대기)
 */
async function waitForContainerReady(containerId, accessToken, maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await axios.get(`${GRAPH_BASE_URL}/${containerId}`, {
      params: {
        fields: 'status_code,status',
        access_token: accessToken
      }
    });

    const status = res.data.status_code;
    if (status === 'FINISHED') return true;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Media Container 오류 발생: ${res.data.status || status}`);
    }

    await delay(3000); // 3초 대기 후 재조회
  }
  throw new Error('Media Container 준비 시간 초과 (Timeout)');
}

/**
 * 1. 단일 이미지 피드 게시
 */
async function publishInstagramSingle(imageUrl, caption, igUserId, accessToken) {
  try {
    // 1단계: Media Item Container 생성
    const createRes = await axios.post(`${GRAPH_BASE_URL}/${igUserId}/media`, null, {
      params: {
        image_url: imageUrl,
        caption: caption,
        access_token: accessToken
      }
    });
    const creationId = createRes.data.id;

    // 2단계: 컨테이너 처리 대기
    await waitForContainerReady(creationId, accessToken);

    // 3단계: 최종 게시 (Publish)
    const publishRes = await axios.post(`${GRAPH_BASE_URL}/${igUserId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken
      }
    });

    return {
      success: true,
      postId: publishRes.data.id,
      postUrl: `https://www.instagram.com/p/${publishRes.data.id}`
    };
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    throw new Error(`단일 이미지 게시 실패: ${detail}`);
  }
}

/**
 * 2. 캐러셀(카드뉴스) 슬라이드 피드 게시
 */
async function publishInstagramCarousel(imageUrls, caption, igUserId, accessToken) {
  try {
    if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
      throw new Error('캐러셀 게시를 위해서는 최소 2장 이상의 이미지가 필요합니다.');
    }

    // 1단계: 슬라이드별 하위 미디어 컨테이너 생성
    const childContainerIds = [];
    for (const url of imageUrls) {
      const itemRes = await axios.post(`${GRAPH_BASE_URL}/${igUserId}/media`, null, {
        params: {
          image_url: url,
          is_carousel_item: true,
          access_token: accessToken
        }
      });
      childContainerIds.push(itemRes.data.id);
    }

    // 하위 컨테이너들이 처리될 때까지 대기
    for (const childId of childContainerIds) {
      await waitForContainerReady(childId, accessToken);
    }

    // 2단계: 전체 캐러셀 부모 컨테이너 생성
    const carouselRes = await axios.post(`${GRAPH_BASE_URL}/${igUserId}/media`, null, {
      params: {
        media_type: 'CAROUSEL',
        children: childContainerIds.join(','),
        caption: caption,
        access_token: accessToken
      }
    });
    const carouselContainerId = carouselRes.data.id;

    // 부모 컨테이너 준비 확인
    await waitForContainerReady(carouselContainerId, accessToken);

    // 3단계: 최종 게시 (Publish)
    const publishRes = await axios.post(`${GRAPH_BASE_URL}/${igUserId}/media_publish`, null, {
      params: {
        creation_id: carouselContainerId,
        access_token: accessToken
      }
    });

    return {
      success: true,
      postId: publishRes.data.id,
      postUrl: `https://www.instagram.com/p/${publishRes.data.id}`
    };
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    throw new Error(`캐러셀 게시 실패: ${detail}`);
  }
}

module.exports = {
  publishInstagramSingle,
  publishInstagramCarousel
};
