import { Global, Module } from "@nestjs/common";
import { AuthContextService } from "./auth-context";

// @Global so both CommonModule's guards (JwtAuthGuard) and AuthModule's
// RefreshService can inject AuthContextService without importing each
// other — importing this module once anywhere in the graph is enough.
@Global()
@Module({
  providers: [AuthContextService],
  exports: [AuthContextService],
})
export class AuthContextModule {}
