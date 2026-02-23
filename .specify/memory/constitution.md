<!--
Sync Impact Report
==================
Version change: 0.0.0 → 1.0.0
Added principles:
  - I. API-First Architecture
  - II. Real-Time Priority
  - III. Modular ASR Backend
  - IV. Data Reliability
  - V. Simplicity First
Added sections:
  - Technology Standards
  - Development Workflow
Removed sections: None (initial creation)
Templates status:
  - plan-template.md: ✅ Compatible (Constitution Check section ready)
  - spec-template.md: ✅ Compatible
  - tasks-template.md: ✅ Compatible
Follow-up TODOs: None
-->

# ServiceLiveTrans Constitution

## Core Principles

### I. API-First Architecture

ServiceLiveTrans follows a strict frontend-backend separation model. The Nuxt application serves as the web interface while all business logic resides in backend services.

- All frontend-backend communication MUST occur through well-defined REST or WebSocket APIs
- API contracts MUST be documented before implementation
- Frontend MUST NOT contain business logic; it handles presentation and user interaction only
- Backend MUST be independently deployable and testable

**Rationale**: Enables independent development, testing, and scaling of frontend and backend components. Supports future mobile app or third-party integrations.

### II. Real-Time Priority

As a live transcription service, real-time performance is non-negotiable.

- Audio-to-text latency MUST be minimized (target: <500ms from audio segment to text display)
- WebSocket connections MUST be used for real-time transcription streams
- System MUST gracefully handle network interruptions with automatic reconnection
- Status indicators MUST clearly show connection and processing state to users

**Rationale**: Users rely on real-time transcription for live events. Latency directly impacts usability.

### III. Modular ASR Backend

The system MUST support multiple Automatic Speech Recognition backends without frontend changes.

- ASR integration MUST be abstracted behind a common interface
- System MUST support at minimum: Whisper API (remote) and FunASR API (remote)
- Adding a new ASR backend MUST NOT require frontend modifications
- ASR backend selection MUST be configurable per session/event

**Rationale**: Different ASR providers have different strengths (accuracy, language support, cost). Modularity enables switching or using multiple providers.

### IV. Data Reliability

Transcription data is valuable and must be preserved.

- All transcription sessions MUST be persistable to storage
- Data loss MUST be prevented through appropriate backup strategies
- Export functionality MUST be provided for transcription records
- User MUST be able to recover from interruptions without losing transcription history

**Rationale**: Users may need to reference transcriptions after events. Data loss undermines trust in the service.

### V. Simplicity First

Avoid over-engineering. Start with the simplest solution that meets requirements.

- No premature abstractions; wait for concrete use cases
- No unused features; implement only what is specified
- Prefer standard solutions over custom implementations
- Complexity MUST be justified against simpler alternatives

**Rationale**: This is a refactored project with clear scope. Unnecessary complexity slows development and introduces bugs.

## Technology Standards

**Frontend Stack** (Mandatory):
- Nuxt 4 with Vue 3
- TypeScript for type safety
- Nuxt UI for components
- pnpm for package management

**Backend Stack** (To be determined per implementation):
- Language: Node.js (TypeScript) or Python recommended
- Database: PostgreSQL or SQLite for development
- Real-time: WebSocket for audio streaming

**Code Quality**:
- ESLint + Prettier for code formatting
- TypeScript strict mode enabled
- No `any` types without justification

## Development Workflow

**Branch Strategy**:
- `main` - production-ready code
- `master` - development branch (current)
- Feature branches: `###-feature-name`

**Commit Guidelines**:
- Clear, descriptive commit messages
- Logical commits (one concern per commit)
- No broken commits to main/master

**Review Requirements**:
- Constitution compliance check before merging
- No placeholder code in production

## Governance

This constitution supersedes all other development practices. Amendments require:

1. Documentation of the proposed change
2. Justification for why the change is needed
3. Impact analysis on existing code/features
4. Migration plan if breaking changes are involved

All code changes MUST comply with these principles. When in doubt, choose simplicity over complexity.

**Version**: 1.0.0 | **Ratified**: 2026-02-23 | **Last Amended**: 2026-02-23
