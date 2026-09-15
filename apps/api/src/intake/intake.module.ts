import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IntakeController } from './intake.controller.js';
import { IntakeService } from './intake.service.js';
import { OptionalCustomerJwtGuard } from '../auth/guards/optional-customer-jwt.guard.js';
import { CustomerTokenService } from '../auth/tokens/customer-token.service.js';
import { ASR_PROVIDER } from './asr/asr-provider.interface.js';
import { DevAsrProvider } from './asr/dev-asr.provider.js';
import { DeepgramAsrProvider } from './asr/deepgram-asr.provider.js';
import { DIALOGUE_ENGINE } from './llm/dialogue-engine.interface.js';
import { DevDialogueEngine } from './llm/dev-dialogue.engine.js';
import { ClaudeDialogueEngine } from './llm/claude-dialogue.engine.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [IntakeController],
  providers: [
    IntakeService,
    OptionalCustomerJwtGuard,
    CustomerTokenService,
    {
      provide: ASR_PROVIDER,
      // Defaults to the dev stub — ASR_PROVIDER=deepgram must be set
      // explicitly, and requires DEEPGRAM_API_KEY. See docs/decisions.md
      // Part 8 Q1.
      useClass: process.env.ASR_PROVIDER === 'deepgram' ? DeepgramAsrProvider : DevAsrProvider,
    },
    {
      provide: DIALOGUE_ENGINE,
      // Defaults to the dev stub — LLM_PROVIDER=anthropic must be set
      // explicitly, and requires ANTHROPIC_API_KEY. See docs/decisions.md
      // Part 8 Q2.
      useClass: process.env.LLM_PROVIDER === 'anthropic' ? ClaudeDialogueEngine : DevDialogueEngine,
    },
  ],
})
export class IntakeModule {}
