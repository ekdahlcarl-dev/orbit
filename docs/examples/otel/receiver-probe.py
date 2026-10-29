#!/usr/bin/env python3
"""Synthetic ORB-19 storage probe; no ORBIT runtime imports or secrets."""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

OTLP = "http://127.0.0.1:14318"
GRAFANA = "http://127.0.0.1:13000/api/datasources/proxy/uid"
events = json.loads(Path(__file__).with_name("events.json").read_text())
assert len(events) == 5
allowed = set("timestamp severity event_name message trace_id span_id request_id operation_id error_id error_code error_type code_file code_function code_line repository_id build_run_id job_id github_run_id installation_id workflow_id check_run_id artifact_id evidence_id delivery_id trigger_key repository_commit_sha artifact_digest attempt github_run_attempt outcome correlation_status confidence_stage duration_ms count".split())
resources = {"service.name", "service.namespace", "service.version", "deployment.environment.name", "orbit.telemetry.version"}
for event in events:
    assert not set(event) - allowed - resources
    assert re.fullmatch(r"[0-9a-f]{32}", event["trace_id"])
    assert re.fullmatch(r"[0-9a-f]{16}", event["span_id"])
    assert len(json.dumps(event).encode()) <= 8192
    assert all(not isinstance(v, str) or len(v.encode()) <= 256 for v in event.values())
    if "error_id" in event:
        assert re.fullmatch(r"[0-9a-f-]{36}", event["error_id"])
        assert event["code_file"].startswith("src/")


def request(url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def attrs(values):
    return [{"key": key, "value": {"intValue": str(value)} if isinstance(value, int) else {"stringValue": value}} for key, value in values.items()]


now = time.time_ns()
spans, logs = [], []
for index, original in enumerate(events):
    event = {**original, "service.name": "orbit-receiver-spike"}
    # Unique IDs per execution avoid matching an earlier probe's data.
    event["trace_id"] = f"{now + index:032x}"
    event["span_id"] = f"{index + 1:016x}"
    events[index] = event
    properties = {key: value for key, value in event.items() if key not in resources}
    properties["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    span_attrs = {"orbit.event.name": event["event_name"], "orbit.repository.id": event["repository_id"], "orbit.outcome": event["outcome"]}
    if "error_id" in event:
        span_attrs.update({"orbit.error.id": event["error_id"], "error.type": event["error_code"], "code.file.path": event["code_file"], "code.line.number": event["code_line"]})
    spans.append({"traceId": event["trace_id"], "spanId": event["span_id"], "name": event["event_name"], "kind": 1,
                  "startTimeUnixNano": str(now), "endTimeUnixNano": str(now + 1000000), "attributes": attrs(span_attrs)})
    logs.append({"timeUnixNano": str(now), "severityText": event["severity"], "severityNumber": 17 if event["severity"] == "ERROR" else 9,
                 "traceId": event["trace_id"], "spanId": event["span_id"], "body": {"stringValue": json.dumps(properties)}})

resource = {"attributes": attrs({**{key: events[0][key] for key in resources}, "service.name": "orbit-receiver-spike"})}
scope = {"name": "orbit.telemetry.receiver-probe", "version": "1.0.0"}
trace_response = request(OTLP + "/v1/traces", {"resourceSpans": [{"resource": resource, "scopeSpans": [{"scope": scope, "spans": spans}]}]})
log_response = request(OTLP + "/v1/logs", {"resourceLogs": [{"resource": resource, "scopeLogs": [{"scope": scope, "logRecords": logs}]}]})
metric_response = request(OTLP + "/v1/metrics", {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"scope": scope, "metrics": [{"name": "orbit.receiver.probe", "unit": "{event}", "sum": {"aggregationTemporality": 2, "isMonotonic": True, "dataPoints": [{"startTimeUnixNano": str(now - 1000000), "timeUnixNano": str(now), "asInt": "5"}]}}]}]}]})
for response in [trace_response, log_response, metric_response]:
    assert not response.get("partialSuccess"), response


def query(source, path, params):
    return request(GRAFANA + "/" + source + path + "?" + urllib.parse.urlencode(params))


error_event = events[1]
trace_id = error_event["trace_id"]
error_id = error_event["error_id"]
deadline = time.monotonic() + 45
last = None
while time.monotonic() < deadline:
    try:
        log_error = query("loki", "/loki/api/v1/query_range", {"query": '{service_name="orbit-receiver-spike"} | json | error_id="' + error_id + '"', "start": str(now - 1000000000), "end": str(time.time_ns())})
        error_lines = [json.loads(line) for stream in log_error["data"]["result"] for _, line in stream["values"]]
        assert any(line["trace_id"] == trace_id for line in error_lines)
        log_trace = query("loki", "/loki/api/v1/query_range", {"query": '{service_name="orbit-receiver-spike"} | json | trace_id="' + trace_id + '"', "start": str(now - 1000000000), "end": str(time.time_ns())})
        assert log_trace["data"]["result"]
        trace = request(GRAFANA + "/tempo/api/traces/" + trace_id)
        assert error_id in json.dumps(trace)
        search = query("tempo", "/api/search", {"q": '{ span.orbit.error.id = "' + error_id + '" }', "start": str(now // 1000000000 - 60), "end": str(time.time_ns() // 1000000000 + 60)})
        # Tempo search omits leading zeroes; OTLP/log trace IDs are fixed-width.
        assert any(int(t["traceID"], 16) == int(trace_id, 16) for t in search["traces"])
        metric = query("prometheus", "/api/v1/query", {"query": '{__name__=~"orbit_receiver_probe.*"}'})
        assert any(float(item["value"][1]) == 5 for item in metric["data"]["result"])
        print(json.dumps({"result": "PASS", "events": len(events), "error_id": error_id, "trace_id": trace_id, "checks": ["fixture fields/size", "OTLP three signals accepted without partial rejection", "Loki error_id", "Loki trace_id", "Tempo direct trace", "Tempo error attribute search", "Prometheus metric sample"]}, indent=2))
        break
    except (AssertionError, KeyError, urllib.error.URLError) as error:
        last = str(error)
        time.sleep(2)
else:
    raise RuntimeError("Receiver search did not converge: " + str(last))
