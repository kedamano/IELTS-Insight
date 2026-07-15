from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.models.database import init_db
from app.services import router

app = FastAPI(title=settings.APP_NAME)

# CORS：开发阶段允许所有，生产环境限制为 tauri://localhost
allow_origins = ["*"] if settings.DEBUG else ["tauri://localhost", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    init_db()
    print(f"[Startup] Server ready at http://{settings.API_HOST}:{settings.API_PORT}")

app.include_router(router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
