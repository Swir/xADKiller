import hashlib
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('audit', Path(__file__).parents[1]/'audit_feed_freshness.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)


def fixture(age=1, schema=1, expiry=10):
    data = dict(schema=schema, feed_version='2026.11.04.1', updated_at=(NOW-timedelta(days=age)).isoformat())
    if schema == 2:
        data['expires_at'] = (NOW+timedelta(days=expiry)).isoformat()
    body = json.dumps(data).encode()
    entry = dict(id='live-shield', label='test', url='https://example.invalid/feed', expected_schema=schema,
                 feed_version=data['feed_version'], updated_at=data['updated_at'], expires_at=data.get('expires_at'),
                 git_blob_sha1=hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest())
    return entry, body


class FreshnessTests(unittest.TestCase):
    def test_fresh_matching_payload_passes(self):
        entry, body = fixture()
        self.assertEqual(audit.inspect(entry, body, NOW)['errors'], [])

    def test_matching_hash_does_not_hide_stale_data(self):
        entry, body = fixture(age=53)
        self.assertIn('feed is older than the runtime 45-day limit', audit.inspect(entry, body, NOW)['errors'])

    def test_runtime_age_boundary_and_advance_warning(self):
        for age in [30, 45]:
            entry, body = fixture(age=age)
            result = audit.inspect(entry, body, NOW)
            self.assertFalse(result['errors'])
            self.assertTrue(result['warnings'])
        entry, body = fixture(age=45.01)
        self.assertTrue(audit.inspect(entry, body, NOW)['errors'])

    def test_expired_parallel_payload_fails_even_when_recent(self):
        entry, body = fixture(age=3, schema=2, expiry=-1)
        self.assertIn('feed has expired', audit.inspect(entry, body, NOW)['errors'])

    def test_expiry_warning_and_lifetime_limit(self):
        entry, body = fixture(schema=2, expiry=7)
        self.assertTrue(audit.inspect(entry, body, NOW)['warnings'])
        entry, body = fixture(schema=2, expiry=70)
        self.assertTrue(audit.inspect(entry, body, NOW)['errors'])

    def test_remote_payload_is_checked_not_only_manifest(self):
        entry, body = fixture()
        data = json.loads(body)
        data['updated_at'] = (NOW-timedelta(days=53)).isoformat()
        results = audit.audit([entry], NOW, lambda url: json.dumps(data).encode())
        self.assertIn('published payload differs from approved checksum', results[0]['errors'])
        self.assertIn('feed is older than the runtime 45-day limit', results[0]['errors'])

    def test_future_date_and_invalid_timestamp_fail(self):
        entry, body = fixture(age=-2)
        self.assertTrue(audit.inspect(entry, body, NOW)['errors'])
        with self.assertRaises(ValueError):
            audit.timestamp('2026-11-05T00:00:00')

    def test_network_error_is_not_a_pass_and_other_feeds_continue(self):
        entry, body = fixture()
        def fetch(url):
            if url.endswith('/feed'):
                raise TimeoutError('unavailable')
            return body
        other = dict(entry, id='titan', url='https://example.invalid/other')
        result = audit.audit([entry, other], NOW, fetch)
        self.assertTrue(result[0]['errors'])
        self.assertFalse(result[1]['errors'])

    def test_manifest_requires_all_feed_roles(self):
        with self.assertRaises(ValueError):
            audit.targets({'schema':1,'algorithm':'git-blob-sha1','feeds':[]}, {'schema':1,'remote_executable_code':False})

    def test_unsafe_source_paths_are_rejected(self):
        for ref, path in [('main','browser-intelligence/../secret.json'), ('../other','browser-intelligence/live.json')]:
            with self.assertRaises(ValueError):
                audit.endpoint(ref, path)


if __name__ == '__main__':
    unittest.main()
