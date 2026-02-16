# Known Limitations

현재 인지하고 있지만 즉시 해결하지 않은 제약 사항.
해결하면 해당 항목을 삭제한다.

## Telegram

- **callback_data 64바이트 제한**: 현재 `good:{UUID}` 형식으로 최대 41바이트. 안전하지만, 데이터를 더 넣으려면 이 제한에 걸림.

## Langfuse 프롬프트

- **프롬프트 fetch가 critical path에 있음**: KV 캐시 미스 시(5분마다) Langfuse API 왕복이 사용자 응답을 지연시킴. 사용자가 늘면 TTL 증가 또는 stale-while-revalidate 패턴 고려.
- **KV 캐시 즉시 무효화 불가**: Langfuse UI에서 프롬프트를 바꿔도 최대 5분간 이전 버전 사용. 긴급 시 `wrangler kv key delete`로 `prompt:system-prompt` 키 수동 삭제.
