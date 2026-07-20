from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.permissions import ensure_project_editor, ensure_project_member
from app.core.config import get_settings
from app.models.user import User
from app.models.knowledge import KnowledgeDoc, DocChunk
from app.models.activity import ActivityLog
from app.schemas import (
    KnowledgeDocCreate, KnowledgeDocUpdate, KnowledgeDocOut,
    KnowledgeQuery, KnowledgeAnswer,
)
from app.services.rag_service import rag_service
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/projects/{project_id}/knowledge", tags=["knowledge"])
settings = get_settings()
ALLOWED_UPLOAD_EXTENSIONS = {
    "pdf", "docx", "pptx", "xls", "xlsx", "html", "htm", "md", "txt",
    "csv", "json", "xml", "jpg", "jpeg", "png", "gif", "bmp", "tiff",
    "wav", "mp3",
}


@router.get("", response_model=list[KnowledgeDocOut])
async def list_docs(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    result = await db.execute(
        select(KnowledgeDoc)
        .where(KnowledgeDoc.project_id == project_id)
        .order_by(KnowledgeDoc.updated_at.desc())
    )
    docs = result.scalars().all()

    output = []
    for d in docs:
        count_result = await db.execute(
            select(func.count(DocChunk.id)).where(DocChunk.doc_id == d.id)
        )
        out = KnowledgeDocOut.model_validate(d)
        out.chunk_count = count_result.scalar() or 0
        output.append(out)
    return output


@router.post("", response_model=KnowledgeDocOut, status_code=201)
async def create_doc(
    project_id: int,
    data: KnowledgeDocCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_editor(project_id, current_user, db)
    doc = KnowledgeDoc(
        project_id=project_id,
        title=data.title,
        content=data.content,
        file_type=data.file_type,
        created_by=current_user.id,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    try:
        await rag_service.chunk_document(data.title, data.content, doc.id, db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"文档索引失败: {exc}") from exc

    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="create",
        target_type="doc",
        target_id=doc.id,
        summary=f"添加知识文档: {doc.title}",
    ))

    count_result = await db.execute(
        select(func.count(DocChunk.id)).where(DocChunk.doc_id == doc.id)
    )
    out = KnowledgeDocOut.model_validate(doc)
    out.chunk_count = count_result.scalar() or 0
    return out


@router.get("/{doc_id}", response_model=KnowledgeDocOut)
async def get_doc(
    project_id: int,
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    result = await db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.id == doc_id,
            KnowledgeDoc.project_id == project_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    count_result = await db.execute(
        select(func.count(DocChunk.id)).where(DocChunk.doc_id == doc.id)
    )
    out = KnowledgeDocOut.model_validate(doc)
    out.chunk_count = count_result.scalar() or 0
    return out


@router.put("/{doc_id}", response_model=KnowledgeDocOut)
async def update_doc(
    project_id: int,
    doc_id: int,
    data: KnowledgeDocUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_editor(project_id, current_user, db)
    result = await db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.id == doc_id,
            KnowledgeDoc.project_id == project_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(doc, field, value)

    # Re-chunk if content changed
    if data.content is not None:
        await db.execute(
            delete(DocChunk).where(DocChunk.doc_id == doc.id)
        )
        try:
            await rag_service.chunk_document(doc.title, doc.content, doc.id, db)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"文档索引失败: {exc}") from exc

    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="update",
        target_type="doc",
        target_id=doc.id,
        summary=f"更新知识文档: {doc.title}",
    ))

    await db.flush()
    await db.refresh(doc)
    return KnowledgeDocOut.model_validate(doc)


@router.delete("/{doc_id}")
async def delete_doc(
    project_id: int,
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_editor(project_id, current_user, db)
    result = await db.execute(
        select(KnowledgeDoc).where(
            KnowledgeDoc.id == doc_id,
            KnowledgeDoc.project_id == project_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="delete",
        target_type="doc",
        target_id=doc.id,
        summary=f"删除知识文档: {doc.title}",
    ))
    await db.delete(doc)
    return {"message": "文档已删除"}


@router.post("/upload", response_model=KnowledgeDocOut, status_code=201)
async def upload_file(
    project_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and parse it to markdown using markitdown, then create a knowledge doc."""
    await ensure_project_editor(project_id, current_user, db)
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的文件格式")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(file_bytes) > settings.knowledge_max_bytes:
        max_mb = settings.knowledge_max_bytes // 1024 // 1024
        raise HTTPException(status_code=413, detail=f"文件大小不能超过 {max_mb}MB")

    # Parse file to markdown using markitdown
    try:
        from io import BytesIO
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert_stream(BytesIO(file_bytes), file_extension=ext)
        content = result.text_content
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"文件解析失败: {str(e)}")

    if not content.strip():
        raise HTTPException(status_code=400, detail="文件解析结果为空，请检查文件内容")

    # Strip extension from filename for title
    title = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename

    doc = KnowledgeDoc(
        project_id=project_id,
        title=title,
        content=content,
        file_type=ext,
        created_by=current_user.id,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    try:
        await rag_service.chunk_document(title, content, doc.id, db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"文档索引失败: {exc}") from exc

    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="create",
        target_type="doc",
        target_id=doc.id,
        summary=f"上传知识文档: {doc.title}",
    ))

    count_result = await db.execute(
        select(func.count(DocChunk.id)).where(DocChunk.doc_id == doc.id)
    )
    out = KnowledgeDocOut.model_validate(doc)
    out.chunk_count = count_result.scalar() or 0
    return out


@router.post("/query", response_model=KnowledgeAnswer)
async def query_knowledge(
    project_id: int,
    data: KnowledgeQuery,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query the knowledge base using RAG."""
    await ensure_project_member(project_id, current_user, db)
    try:
        result = await rag_service.query_with_context(
            query=data.question,
            project_id=project_id,
            db=db,
            llm_service=llm_service,
            top_k=data.top_k,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"知识库查询失败: {exc}") from exc
    return KnowledgeAnswer(**result)
