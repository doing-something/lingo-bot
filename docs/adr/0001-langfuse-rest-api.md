# ADR-0001: Langfuse 연동에 REST API 직접 호출 방식 채택

## Status

Accepted (2026-02-16)

## Context

LLM 운영 모니터링(토큰/비용 추적, 프롬프트 감사, 품질 평가)을 위해 Langfuse 도입을 결정했다.

Langfuse JS SDK(v4)는 OpenTelemetry 기반으로 전면 개편되었으며, `@langfuse/otel`은 Node.js 20 이상을 요구한다. 현재 프로젝트는 Cloudflare Workers(V8 isolate) 위에서 동작하며, `nodejs_compat` 플래그로도 OpenTelemetry의 `async_hooks` 등 깊은 Node.js 의존성을 충족하기 어렵다.

## Options

### A. Langfuse REST API 직접 호출

- `/api/public/ingestion` 엔드포인트에 trace/generation을 `fetch`로 전송
- SDK 의존성 없음, Cloudflare Workers 제약 없음
- SDK의 자동 트레이싱, 데코레이터, 컨텍스트 전파 사용 불가

### B. 레거시 `langfuse` npm 패키지

- edge 런타임 호환 (Universal JS)
- deprecated 상태로 향후 지원 불확실

### C. Node.js 런타임으로 전환

- Vercel/Railway/Fly.io 등에서 Node.js 서버로 이전
- Langfuse SDK + Gemini SDK 정식 사용 가능
- 인프라 변경이 크고, Cloudflare KV도 다른 저장소로 교체 필요

## Decision

**Option A: REST API 직접 호출**을 채택한다.

현재 프로젝트 구조가 요청당 Gemini 1회 호출의 단일 흐름이라, SDK의 자동 트레이싱/데코레이터가 실질적 이점을 주지 않는다. trace 1개 + generation 1개를 batch로 전송하면 충분하다.

## Consequences

### 긍정적

- 인프라 변경 없이 즉시 적용 가능
- REST API는 SDK 버전과 무관하게 안정적
- Langfuse 데이터 모델(Trace, Generation, Span)을 직접 이해하게 됨
- 다른 Cloudflare Workers 프로젝트에 재활용 가능

### 부정적

- SDK의 자동 트레이싱, 배치 최적화 등 편의 기능 사용 불가
- API 스펙 변경 시 직접 대응 필요

### 재검토 시점

- RAG 파이프라인, 멀티 에이전트 등 복잡한 호출 구조가 도입될 때
- Node.js 런타임으로 전환하게 될 때
- Langfuse가 edge 런타임용 공식 SDK를 출시할 때
