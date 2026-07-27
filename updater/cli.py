import argparse
import json
import uuid

from server import load_state, run_operation


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a FlowMind update synchronously")
    parser.add_argument("version")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--request-id", default=uuid.uuid4().hex)
    args = parser.parse_args()
    operation = "rollback" if args.rollback else "update"
    run_operation(operation, args.version, args.request_id)
    state = load_state()
    print(json.dumps(state, ensure_ascii=False, indent=2))

    expected_status = "rolled_back" if operation == "rollback" else "succeeded"
    if state.get("request_id") != args.request_id or state.get("status") != expected_status:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
