import importlib.util
import pathlib
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / 'app.py'
SPEC = importlib.util.spec_from_file_location('agent_stack_runtime_gateway_app', MODULE_PATH)
runtime_gateway = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(runtime_gateway)


class RuntimeGatewayPolicyTests(unittest.TestCase):
    def test_denies_missing_and_invalid_bearer_tokens(self):
        with patch.object(runtime_gateway, 'BEARER', 'secret-token'):
            client = TestClient(runtime_gateway.app)

            missing = client.get('/v1/capabilities')
            self.assertEqual(missing.status_code, 401)
            self.assertEqual(missing.json()['detail']['code'], 'missing_bearer')

            invalid = client.get('/v1/capabilities', headers={'authorization': 'Bearer wrong-token'})
            self.assertEqual(invalid.status_code, 401)
            self.assertEqual(invalid.json()['detail']['code'], 'invalid_bearer')

    def test_aliases_and_model_caps_are_applied_before_proxying(self):
        captured = {}

        async def fake_json_proxy(method, path, body, headers):
            captured['method'] = method
            captured['path'] = path
            captured['body'] = body
            return JSONResponse(status_code=200, content={'ok': True, 'body': body})

        with patch.object(runtime_gateway, 'ALLOWED_MODELS', {'allowed-model'}), \
             patch.object(runtime_gateway, 'ALIASES', {'alias-model': 'allowed-model'}), \
             patch.object(runtime_gateway, 'FALLBACKS', {}), \
             patch.object(runtime_gateway, 'MAX_TOKENS_BY_MODEL', {'allowed-model': 64}), \
             patch.object(runtime_gateway, 'ENDPOINT_CAPS', {'/v1/chat/completions': 128}), \
             patch.object(runtime_gateway, 'MAX_TOKENS_ABSOLUTE', 8192), \
             patch.object(runtime_gateway, '_json_proxy', new=fake_json_proxy):
            client = TestClient(runtime_gateway.app)
            response = client.post('/v1/chat/completions', json={
                'model': 'alias-model',
                'messages': [{'role': 'user', 'content': 'hi'}],
                'max_tokens': 999,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured['method'], 'POST')
        self.assertEqual(captured['path'], '/v1/chat/completions')
        self.assertEqual(captured['body']['model'], 'allowed-model')
        self.assertEqual(captured['body']['max_tokens'], 64)

    def test_fallbacks_are_normalized_before_allowlist_checks(self):
        captured = {}

        async def fake_json_proxy(method, path, body, headers):
            captured['body'] = body
            return JSONResponse(status_code=200, content={'ok': True, 'body': body})

        with patch.object(runtime_gateway, 'ALLOWED_MODELS', {'allowed-model'}), \
             patch.object(runtime_gateway, 'ALIASES', {}), \
             patch.object(runtime_gateway, 'FALLBACKS', {'fallback-model': 'allowed-model'}), \
             patch.object(runtime_gateway, 'MAX_TOKENS_BY_MODEL', {'allowed-model': 32}), \
             patch.object(runtime_gateway, '_json_proxy', new=fake_json_proxy):
            client = TestClient(runtime_gateway.app)
            response = client.post('/v1/chat/completions', json={
                'model': 'fallback-model',
                'messages': [{'role': 'user', 'content': 'hi'}],
                'max_tokens': 12,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured['body']['model'], 'allowed-model')
        self.assertEqual(captured['body']['max_tokens'], 12)

    def test_blocked_models_are_rejected(self):
        with patch.object(runtime_gateway, 'ALLOWED_MODELS', {'allowed-model'}), \
             patch.object(runtime_gateway, 'DEFAULT_ACTION', 'deny'), \
             patch.object(runtime_gateway, 'DENY_REASON', 'model not allowed'):
            client = TestClient(runtime_gateway.app)
            response = client.post('/v1/chat/completions', json={
                'model': 'blocked-model',
                'messages': [{'role': 'user', 'content': 'hi'}],
                'max_tokens': 8,
            })

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['detail']['code'], 'model_not_allowed')


if __name__ == '__main__':
    unittest.main()