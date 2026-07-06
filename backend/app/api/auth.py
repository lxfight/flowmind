from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register():
    pass


@router.post("/login")
async def login():
    pass
