"""迁移脚本：将 SQLite 数据导出到 PostgreSQL。

用法：
  1. 启动 PostgreSQL:  docker compose up -d
  2. 配置环境变量指向 SQLite（默认）并导出数据:
     python scripts/migrate.py export data.json
  3. 配置环境变量指向 PostgreSQL 并导入数据:
     python scripts/migrate.py import data.json

注意：确保 SQLite 数据库文件存在，且 PostgreSQL 容器已运行。
"""

import argparse
import json
import os
import sys
import sqlite3
from datetime import datetime

# 表结构和导入顺序
TABLES = [
    "users",
    "projects",
    "project_members",
    "task_statuses",
    "tasks",
    "task_comments",
    "activity_logs",
    "knowledge_docs",
    "doc_chunks",
]


def export_data(sqlite_path: str, output: str):
    """从 SQLite 导出所有表数据到 JSON 文件。"""
    if not os.path.exists(sqlite_path):
        print(f"错误: SQLite 数据库文件不存在: {sqlite_path}")
        sys.exit(1)

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    data = {}

    for table in TABLES:
        try:
            cursor.execute(f"SELECT * FROM {table}")
            rows = [dict(row) for row in cursor.fetchall()]
            # 将 datetime/date 对象转换为 ISO 字符串
            for row in rows:
                for k, v in row.items():
                    if isinstance(v, datetime):
                        row[k] = v.isoformat()
            data[table] = rows
            print(f"  导出 {table}: {len(rows)} 条记录")
        except sqlite3.OperationalError as e:
            print(f"  跳过 {table}: {e}")
            data[table] = []

    # 导出 doc_chunk_embeddings（如果存在）
    try:
        cursor.execute("SELECT * FROM doc_chunk_embeddings")
        rows = [dict(row) for row in cursor.fetchall()]
        for row in rows:
            for k, v in row.items():
                if isinstance(v, datetime):
                    row[k] = v.isoformat()
        data["doc_chunk_embeddings"] = rows
        print(f"  导出 doc_chunk_embeddings: {len(rows)} 条记录")
    except sqlite3.OperationalError:
        data["doc_chunk_embeddings"] = []
        print("  跳过 doc_chunk_embeddings（表不存在）")

    conn.close()

    with open(output, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    print(f"\n数据已导出到 {output}")


def date_or_none(val):
    """将 ISO 字符串或 None 转换为适合 PostgreSQL 的值。"""
    if val is None:
        return None
    return val


def import_data(input_path: str, database_url: str):
    """从 JSON 文件将数据导入 PostgreSQL。"""
    if not os.path.exists(input_path):
        print(f"错误: 数据文件不存在: {input_path}")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 使用 SQLAlchemy 连接到 PostgreSQL
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from sqlalchemy import text

    async def do_import():
        engine = create_async_engine(database_url, echo=False)
        async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with engine.begin() as conn:
            # 创建 vector 扩展
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            # 创建所有表
            from app.core.database import Base
            await conn.run_sync(Base.metadata.create_all)

        async with async_session_factory() as session:
            for table in TABLES + (["doc_chunk_embeddings"] if "doc_chunk_embeddings" in data and data["doc_chunk_embeddings"] else []):
                rows = data.get(table, [])
                if not rows:
                    print(f"  跳过 {table}: 无数据")
                    continue

                # 获取列名
                columns = list(rows[0].keys())
                placeholders = ", ".join([f":{c}" for c in columns])

                for row in rows:
                    # 处理 embedding 字段 — 从 JSON 字符串转换为 pgvector 格式
                    clean = {}
                    for k, v in row.items():
                        if k == "embedding" and v is not None:
                            if isinstance(v, str):
                                # 可能已经是 JSON 数组字符串
                                try:
                                    arr = json.loads(v)
                                    clean[k] = str(arr)
                                except (json.JSONDecodeError, TypeError):
                                    clean[k] = v
                            else:
                                clean[k] = str(v)
                        else:
                            clean[k] = v

                    stmt = text(
                        f"INSERT INTO {table} ({', '.join(columns)}) "
                        f"VALUES ({placeholders}) "
                        f"ON CONFLICT (id) DO NOTHING"
                    )
                    await session.execute(stmt, clean)

                print(f"  导入 {table}: {len(rows)} 条记录")

            await session.commit()

        await engine.dispose()
        print("\n数据导入完成！")

    asyncio.run(do_import())


def main():
    parser = argparse.ArgumentParser(description="SQLite → PostgreSQL 数据迁移工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # export
    export_parser = subparsers.add_parser("export", help="从 SQLite 导出数据")
    export_parser.add_argument("output", help="输出 JSON 文件路径")
    export_parser.add_argument("--sqlite-path", default="./flowmind.db", help="SQLite 数据库路径")

    # import
    import_parser = subparsers.add_parser("import", help="导入数据到 PostgreSQL")
    import_parser.add_argument("input", help="输入 JSON 文件路径")
    import_parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", "postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind"), help="PostgreSQL 连接 URL")

    args = parser.parse_args()

    if args.command == "export":
        print("正在从 SQLite 导出数据...")
        export_data(args.sqlite_path, args.output)
    elif args.command == "import":
        print("正在导入数据到 PostgreSQL...")
        import_data(args.input, args.database_url)


if __name__ == "__main__":
    main()
