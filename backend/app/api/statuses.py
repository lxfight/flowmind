from fastapi import APIRouter

router = APIRouter(prefix="/api/projects/{project_id}/statuses", tags=["task-statuses"])


@router.get("")
async def list_statuses():
    pass


@router.post("")
async def create_status():
    pass


@router.put("/{status_id}")
async def update_status():
    pass


@router.delete("/{status_id}")
async def delete_status():
    pass
