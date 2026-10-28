'use strict';
// 주문 사진/카톡 글 → 품목·수량 (Anthropic Messages API). 키는 아버지 PC 설정에만 저장.
const API_URL = 'https://api.anthropic.com/v1/messages';

function buildPrompt(items) {
  return `너는 식자재 유통업자의 주문 정리 도우미야. 산후조리원에서 온 주문(사진 또는 글)을 읽고 품목과 수량을 뽑아.
규칙:
- 아래 "품목 목록"에서 가장 맞는 이름을 그대로 골라 name에 써. 맞는 게 없으면 읽은 그대로 써.
- qty는 숫자만. 단위가 kg이면 kg 숫자, 개·팩·단이면 개수. 수량이 안 보이면 null.
- raw에는 주문서에 적힌 원래 글자를 그대로.
- 인사말, 날짜, 서명은 빼.
- 반드시 JSON 배열만 출력: [{"raw":"...","name":"...","qty":1}]

품목 목록:
${items.join('\n')}`;
}

async function readOrder({ image, mediaType, text, items, key, model }, log = console) {
  if (!key) return { ok: false, message: '설정 › 사진 인식에서 API 키를 넣어 주세요' };
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } });
  content.push({ type: 'text', text: text ? `주문 글:\n${text}` : '이 주문 사진을 읽어줘.' });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 4000, system: buildPrompt(items || []), messages: [{ role: 'user', content }] })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.warn('ai error', res.status, body?.error?.message);
      const msg = res.status === 401 ? 'API 키가 맞지 않아요' : res.status === 429 ? '잠시 후 다시 해 주세요 (요청이 많아요)' : res.status === 404 ? '모델 이름을 확인해 주세요' : 'AI 요청이 실패했어요 (' + res.status + ')';
      return { ok: false, message: msg };
    }
    const out = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const json = out.slice(out.indexOf('['), out.lastIndexOf(']') + 1);
    const lines = JSON.parse(json);
    if (!Array.isArray(lines)) throw new Error('not array');
    return { ok: true, lines: lines.filter(l => l && (l.name || l.raw)).map(l => ({ raw: String(l.raw || l.name), name: String(l.name || ''), qty: l.qty == null ? null : Number(l.qty) })) };
  } catch (e) {
    log.warn('ai read failed', e.message);
    return { ok: false, message: e.name === 'AbortError' ? 'AI 응답이 너무 늦어요. 다시 해 주세요' : 'AI가 결과를 정리하지 못했어요. 다시 해 주세요' };
  } finally { clearTimeout(t); }
}

module.exports = { readOrder, buildPrompt };
