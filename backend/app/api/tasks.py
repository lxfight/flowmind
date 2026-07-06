from fastapi import APIRouter

router = APIRouter(prefix="/api/projects/{project_id}/tasks", tags=["tasks"])


@router.get("")
async def list_tasks():
    pass


@router.post("")
async def create_task():
    pass


@router.put("/{task_id}")
async def update_task():
    pass


@router.delete("/{task_id}")
async def delete_task():
    pass


@router.patch("/{task_id}/move")
async def move_task():
    pass


@router.get("/{task_id}")
async def get_task():
    pass
