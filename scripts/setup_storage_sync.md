# Storage Synchronization Setup Guide

This guide covers setting up robust replication between your Primary and Secondary Windows VMS servers to support a scale of 100+ cameras.

## 1. MinIO Bucket Replication (Active-Passive)

For object storage, we use MinIO's native Bucket Replication (not filesystem replication) to continuously mirror objects from Primary to Secondary.

### Prerequisites
- Both MinIO instances must be running.
- You need the MinIO Client (`mc.exe`).

### Setup Steps (Run on Primary Server via CMD)

1. **Configure Aliases for both servers:**
   ```cmd
   mc alias set primary http://192.168.126.200:9000 minioadmin miniopassword
   mc alias set secondary http://192.168.126.36:9000 minioadmin miniopassword
   ```

2. **Enable Versioning on the Target Bucket:**
   Replication requires versioning to be enabled on both sides.
   ```cmd
   mc version enable primary/vms-bucket
   mc version enable secondary/vms-bucket
   ```

3. **Configure Bucket Replication:**
   Set up continuous replication from Primary to Secondary.
   ```cmd
   mc replicate add primary/vms-bucket --remote-bucket secondary/vms-bucket --priority 1
   ```

4. **Verify Replication:**
   Upload a test file to the primary bucket and check if it appears on the secondary bucket.
   ```cmd
   mc cp test.mp4 primary/vms-bucket/
   mc ls secondary/vms-bucket/
   ```

---

## 2. Syncthing for Local Files (`E:\REC`)

To safely synchronize massive disk I/O for 100 cameras, we use Syncthing in a one-way (Send-Only/Receive-Only) configuration.

### Setup Steps

1. **Install Syncthing** on both Primary and Secondary servers.
2. Open the Syncthing Web GUI (`http://localhost:8384`) on both servers.
3. **Link Devices:**
   - On the Primary, click "Add Remote Device" and enter the Device ID of the Secondary.
   - Accept the connection on the Secondary.
4. **Configure the `E:\REC` Folder (Primary Server):**
   - Click "Add Folder".
   - **Folder Path:** `E:\REC`
   - **Folder Type:** Select **Send Only**.
   - Share it with the Secondary device.
5. **Accept the Folder (Secondary Server):**
   - The Secondary will prompt to accept the shared folder.
   - **Folder Path:** `E:\REC`
   - **Folder Type:** Select **Receive Only**.
6. **Verify Sync:**
   - Syncthing will now asynchronously sync block-level changes in the background. 
   - Since the Primary is "Send Only", any accidental file deletions or modifications on the Secondary server will not sync back and corrupt the Primary.
