import asyncio
import os
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import app
from http_limits import BodyLimitMiddleware


class HttpLimitsTests(unittest.TestCase):
    def test_database_lock_returns_503_without_partial_run_then_recovers(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'FAROL_DB': directory + '/locked.db', 'REVIEW_WEBHOOK_URL': '', 'LLM_MODEL': '',
        }), TestClient(app, headers={'X-Farol-Client':'desk'}) as client:
            with sqlite3.connect(directory + '/locked.db') as blocker:
                blocker.execute('begin immediate')
                start = time.monotonic()
                response = client.post('/api/ask', json={'query':'Onde fica o cabo HDMI de reserva?'})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers['retry-after'], '2')
                self.assertLess(time.monotonic() - start, 9)
                self.assertNotIn(directory, response.text)
                self.assertEqual(blocker.execute('select count(*) from runs').fetchone()[0], 0)
                blocker.rollback()
            self.assertEqual(client.post('/api/ask', json={'query':'Onde fica o cabo HDMI de reserva?'}).status_code, 200)
            self.assertEqual(len(client.get('/api/runs').json()), 1)
            self.assertEqual(client.get('/api/health').status_code, 200)
            # A directory is not a readable SQLite database; restore the original
            # configuration afterwards and verify recovery with the same process.
            with patch.dict(os.environ, {'FAROL_DB': directory}):
                broken = client.get('/api/health')
                self.assertEqual(broken.status_code, 503)
                self.assertNotIn(directory, broken.text)
            self.assertEqual(client.get('/api/health').status_code, 200)


class StreamingLimitTests(unittest.IsolatedAsyncioTestCase):
    async def check(self, messages, expected, *, delay=0, headers=()):
        called, sent = [], []
        async def downstream(scope, receive, send):
            called.append(True)
            message = await receive()
            self.assertLessEqual(len(message['body']), 16 * 1024)
        iterator = iter(messages)
        async def receive():
            if delay:
                await asyncio.sleep(delay)
            return next(iterator)
        async def send(message):
            sent.append(message)
        middleware = BodyLimitMiddleware(downstream, seconds=.1)
        await middleware({'type':'http','method':'POST','path':'/api/ask',
                          'headers':[(b'x-farol-client', b'desk'), *headers]}, receive, send)
        self.assertEqual(bool(called), expected == 200)
        if expected != 200:
            self.assertEqual(sent[0]['status'], expected)

    async def test_limit_counts_chunked_bytes_before_json_binding(self):
        await self.check([{'type':'http.request','body':b'x'*9000,'more_body':True},
                          {'type':'http.request','body':b'x'*9000}], 413)
        await self.check([], 413, headers=[(b'content-length', b'20000')])
        await self.check([{'type':'http.request','body':b'x'*20000}], 413,
                         headers=[(b'x-farol-client', b'other')])
        await self.check([], 400, headers=[(b'content-length', b'2'), (b'content-length', b'20000')])

    async def test_valid_split_body_reaches_application(self):
        await self.check([{'type':'http.request','body':b'{','more_body':True},
                          {'type':'http.request','body':b'}'}], 200)

    async def test_incomplete_slow_upload_times_out_before_application(self):
        await self.check([{'type':'http.request','body':b'{','more_body':True}], 408, delay=.3)

    async def test_disconnect_closes_real_middleware_stack_without_running_endpoint(self):
        messages = iter([{'type':'http.request','body':b'{','more_body':True}, {'type':'http.disconnect'}])
        sent = []
        async def receive():
            return next(messages, {'type':'http.disconnect'})
        async def send(message):
            sent.append(message)
        scope = {'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':'POST',
                 'path':'/api/ask','raw_path':b'/api/ask','query_string':b'', 'scheme':'http',
                 'headers':[(b'x-farol-client',b'desk'),(b'content-type',b'application/json')],
                 'client':('127.0.0.1',12345),'server':('127.0.0.1',8083)}
        with patch('storage.save', side_effect=AssertionError('Disconnected request reached persistence')):
            await asyncio.wait_for(app(scope, receive, send), 2)
        self.assertEqual(next(m for m in sent if m['type'] == 'http.response.start')['status'], 499)

    async def test_expired_deadline_does_not_read_another_immediate_chunk(self):
        async def downstream(scope, receive, send):
            self.fail('Expired upload reached application')
        async def receive():
            self.fail('Expired upload must not read more chunks')
        sent = []
        async def send(message):
            sent.append(message)
        await BodyLimitMiddleware(downstream, seconds=0)({'type':'http','method':'POST','path':'/api/ask','headers':[]}, receive, send)
        self.assertEqual(sent[0]['status'], 408)
