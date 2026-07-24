import argparse
import uuid

from server import run_operation


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a FlowMind update synchronously")
    parser.add_argument("version")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--request-id", default=uuid.uuid4().hex)
    args = parser.parse_args()
    run_operation("rollback" if args.rollback else "update", args.version, args.request_id)


if __name__ == "__main__":
    main()
