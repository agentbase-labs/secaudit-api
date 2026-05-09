import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorCodes, type ApiErrorBody } from '@cs-platform/shared';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = {
      error: ApiErrorCodes.INTERNAL,
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        body = { error: mapStatusToCode(status), message: resp };
      } else if (resp && typeof resp === 'object') {
        const r = resp as Record<string, unknown>;
        body = {
          error: String(r['error'] ?? mapStatusToCode(status)),
          message: String(r['message'] ?? exception.message ?? 'Error'),
          ...(r['details'] !== undefined ? { details: r['details'] } : {}),
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return ApiErrorCodes.VALIDATION_ERROR;
    case 401:
      return ApiErrorCodes.UNAUTHORIZED;
    case 403:
      return ApiErrorCodes.FORBIDDEN;
    case 404:
      return ApiErrorCodes.NOT_FOUND;
    case 409:
      return 'conflict';
    case 410:
      return ApiErrorCodes.TOKEN_EXPIRED;
    case 422:
      return ApiErrorCodes.SELF_MODIFY_FORBIDDEN;
    case 429:
      return ApiErrorCodes.THROTTLED;
    default:
      return ApiErrorCodes.INTERNAL;
  }
}
