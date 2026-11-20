"""Bound the body before JSON decoding; works with chunked requests as well."""
import asyncio
import time

from starlette.responses import JSONResponse


class BodyLimitMiddleware:
    def __init__(self, app, maximum=16 * 1024, seconds=10):
        self.app, self.maximum, self.seconds = app, maximum, seconds

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get('headers', []))
        if (scope['type'] != 'http' or scope.get('method') != 'POST'
                or not scope.get('path', '').startswith('/api/')):
            return await self.app(scope, receive, send)

        async def reject(status, detail):
            await JSONResponse({'detail': detail}, status_code=status,
                headers={'Cache-Control': 'no-store'})(scope, receive, send)

        lengths = [value for name, value in scope.get('headers', []) if name == b'content-length']
        if len(lengths) > 1:
            return await reject(400, 'Tamanho do pedido ambíguo.')
        length = headers.get(b'content-length')
        if length is not None:
            if not length.isdigit():
                return await reject(400, 'Tamanho do pedido inválido.')
            if int(length) > self.maximum:
                return await reject(413, 'O pedido excede o limite de 16 KiB.')
        chunks, total = [], 0
        deadline = time.monotonic() + self.seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return await reject(408, 'O envio do pedido demorou demais.')
            try:
                message = await asyncio.wait_for(receive(), remaining)
            except asyncio.TimeoutError:
                return await reject(408, 'O envio do pedido demorou demais.')
            if message['type'] == 'http.disconnect':
                # Complete the ASGI response even if the peer has gone. An
                # outer BaseHTTPMiddleware otherwise reports "No response returned".
                return await reject(499, 'O envio do pedido foi interrompido.')
            data = message.get('body', b'')
            total += len(data)
            if total > self.maximum:
                return await reject(413, 'O pedido excede o limite de 16 KiB.')
            chunks.append(data)
            if not message.get('more_body', False):
                break
        body = b''.join(chunks)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': body, 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)
