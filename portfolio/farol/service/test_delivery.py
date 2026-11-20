import asyncio
import sqlite3
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from app import deliver


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_temporary_queue_error_and_bad_receipt_do_not_kill_worker(self):
        event = {'id':'event-one', 'run_id':'run-one', 'attempts':0}
        sent = []
        def receive(request):
            sent.append(request)
            return httpx.Response(200, json={'event_id':'wrong-event'})
        client = httpx.AsyncClient(transport=httpx.MockTransport(receive))
        # First sleep retries the unavailable database. Second stops a recovered,
        # idle worker without wall-clock delays or any real network connection.
        pause = AsyncMock(side_effect=[None, asyncio.CancelledError()])
        finished = Mock()
        with patch.dict('os.environ', {'REVIEW_WEBHOOK_URL':'http://local.invalid/review', 'REVIEW_WEBHOOK_TOKEN':'fixture-token'}), \
             patch('app.httpx.AsyncClient', return_value=client), \
             patch('app.storage.claim', side_effect=[sqlite3.OperationalError('locked'), event, None]), \
             patch('app.storage.finish', finished), patch('app.asyncio.sleep', pause):
            with self.assertRaises(asyncio.CancelledError):
                await deliver()
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0].headers['Idempotency-Key'], 'event-one')
        finished.assert_called_once_with(event, False)

    async def test_acknowledgement_database_failure_preserves_worker_for_next_event(self):
        events = [{'id':'one','run_id':'r1','attempts':0}, {'id':'two','run_id':'r2','attempts':0}]
        def receive(request):
            return httpx.Response(200, json={'event_id':request.headers['Idempotency-Key']})
        client = httpx.AsyncClient(transport=httpx.MockTransport(receive))
        finished = Mock(side_effect=[sqlite3.OperationalError('locked'), None])
        with patch.dict('os.environ', {'REVIEW_WEBHOOK_URL':'http://local.invalid/review', 'REVIEW_WEBHOOK_TOKEN':'fixture-token'}), \
             patch('app.httpx.AsyncClient', return_value=client), \
             patch('app.storage.claim', side_effect=[*events, None]), \
             patch('app.storage.finish', finished), \
             patch('app.asyncio.sleep', AsyncMock(side_effect=asyncio.CancelledError())):
            with self.assertRaises(asyncio.CancelledError):
                await deliver()
        self.assertEqual(finished.call_count, 2)
        self.assertEqual([call.args[1] for call in finished.call_args_list], [True, True])
