class DummyWebSocketManager:
    def __init__(self):
        self.loop = None

    async def broadcast(self, *args, **kwargs):
        pass

    async def send_personal_message(self, *args, **kwargs):
        pass

    async def connect(self, *args, **kwargs):
        pass

    async def disconnect(self, *args, **kwargs):
        pass

manager = DummyWebSocketManager()