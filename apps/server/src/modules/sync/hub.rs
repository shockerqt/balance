use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct SyncInvalidation {
    pub user_id: i32,
    pub collection: &'static str,
}

#[derive(Clone)]
pub struct SyncHub {
    sender: broadcast::Sender<SyncInvalidation>,
}

impl Default for SyncHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(128);
        Self { sender }
    }
}

impl SyncHub {
    pub fn subscribe(&self) -> broadcast::Receiver<SyncInvalidation> {
        self.sender.subscribe()
    }

    pub fn notify(&self, user_id: i32, collection: &'static str) {
        let _ = self.sender.send(SyncInvalidation {
            user_id,
            collection,
        });
    }
}
