import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * A rejected input is the caller's fault, and it should say what was wrong.
 *
 * ⚠ Without this every `.parse()` in the API raised a ZodError, which Nest does
 * not recognise, so it became `500 Internal server error`. Two things followed
 * from that, both bad:
 *
 *   - Every carefully worded validation message in this codebase — "Amount must
 *     be a decimal string", "Record how the money arrived" — was invisible. The
 *     web client reads `body.message` to show the user, and got nothing.
 *   - A 500 says "the server is broken". A clerk who mistypes an amount would
 *     have reported an outage, and someone would have gone looking for one.
 *
 * The path is included when Zod knows it, because "invalid uuid" without saying
 * WHICH field is barely better than silence.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const messages = error.issues.map((issue) => {
      const where = issue.path.join('.');
      return where ? `${where}: ${issue.message}` : issue.message;
    });

    void reply.status(HttpStatus.BAD_REQUEST).send({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      // An array, like Nest's own validation errors, so the web client's
      // existing `Array.isArray(body.message)` branch already handles it.
      message: messages,
    });
  }
}
