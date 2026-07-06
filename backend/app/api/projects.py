from fastapi import APIRouter

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects():
    pass


@router.post("")
async def create_project():
    pass


@router.get("/{project_id}")
async def get_project():
    pass


@router.put("/{project_id}")
async def update_project():
    pass
