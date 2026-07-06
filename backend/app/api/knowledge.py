from fastapi import APIRouter

router = APIRouter(prefix="/api/projects/{project_id}/knowledge", tags=["knowledge"])


@router.get("")
async def list_docs():
    pass


@router.post("")
async def create_doc():
    pass


@router.get("/{doc_id}")
async def get_doc():
    pass


@router.put("/{doc_id}")
async def update_doc():
    pass


@router.delete("/{doc_id}")
async def delete_doc():
    pass


@router.post("/query")
async def query_knowledge():
    pass
