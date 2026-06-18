package main

import (
	"context"

	"github.com/pocketbase/pocketbase/core"
)

const (
	cloudBackupProviderWebDAV               = "webdav"
	cloudBackupProviderS3                   = "s3"
	cloudBackupStatusIdle                   = "idle"
	cloudBackupStatusSuccess                = "success"
	cloudBackupStatusFailed                 = "failed"
	cloudBackupDefaultScheduleTime          = "03:00"
	cloudBackupDefaultScheduleWeekday       = "monday"
	cloudBackupDefaultRetention             = 7
	cloudBackupMaxRetention                 = 30
	cloudBackupSnapshotMaxBytes       int64 = 50 << 20
)

type cloudBackupConfigResponse struct {
	Config cloudBackupConfigDTO `json:"config"`
}

type cloudBackupSnapshotsResponse struct {
	Snapshots []cloudBackupSnapshotDTO `json:"snapshots"`
}

type cloudBackupCreateSnapshotResponse struct {
	Snapshots []cloudBackupSnapshotDTO `json:"snapshots"`
}

type cloudBackupTestResponse struct {
	OK        bool   `json:"ok"`
	CheckedAt string `json:"checkedAt"`
	Message   string `json:"message,omitempty"`
}

type cloudBackupDeleteSnapshotResponse struct {
	OK bool `json:"ok"`
}

type cloudBackupConfigDTO struct {
	Provider                string                     `json:"provider"`
	WebDAV                  *cloudBackupWebDAVSettings `json:"webdav,omitempty"`
	S3                      *cloudBackupS3Settings     `json:"s3,omitempty"`
	CredentialSet           bool                       `json:"credentialSet"`
	CredentialSetByProvider cloudBackupCredentialState `json:"credentialSetByProvider"`
	PolicyByProvider        cloudBackupPolicyState     `json:"policyByProvider"`
	StatusByProvider        cloudBackupStatusState     `json:"statusByProvider"`
	UpdatedAt               *string                    `json:"updatedAt"`
}

type cloudBackupConfigUpdateRequest struct {
	Provider    string                        `json:"provider"`
	WebDAV      *cloudBackupWebDAVSettings    `json:"webdav,omitempty"`
	S3          *cloudBackupS3Settings        `json:"s3,omitempty"`
	Credentials *cloudBackupCredentialPayload `json:"credentials,omitempty"`
	Policy      cloudBackupPolicy             `json:"policy"`
}

type cloudBackupCreateSnapshotRequest struct {
	Provider string `json:"provider"`
}

type cloudBackupCredentialPayload struct {
	WebDAVPassword    *string `json:"webdavPassword,omitempty"`
	S3SecretAccessKey *string `json:"s3SecretAccessKey,omitempty"`
}

type cloudBackupWebDAVSettings struct {
	URL      string `json:"url"`
	Username string `json:"username,omitempty"`
	Path     string `json:"path,omitempty"`
}

type cloudBackupS3Settings struct {
	Endpoint    string `json:"endpoint"`
	Region      string `json:"region"`
	Bucket      string `json:"bucket"`
	Prefix      string `json:"prefix,omitempty"`
	AccessKeyID string `json:"accessKeyId,omitempty"`
	// 旧配置可能带 addressingStyle；NormalizeAndValidate 会清空它，S3 SDK 寻址只按协议级 endpoint 形态推断。
	AddressingStyle string `json:"addressingStyle,omitempty"`
}

type cloudBackupStoredConfig struct {
	WebDAV *cloudBackupWebDAVSettings `json:"webdav,omitempty"`
	S3     *cloudBackupS3Settings     `json:"s3,omitempty"`
}

type cloudBackupStoredCredential struct {
	WebDAVPassword    string `json:"webdavPassword,omitempty"`
	S3SecretAccessKey string `json:"s3SecretAccessKey,omitempty"`
}

type cloudBackupCredentialState struct {
	WebDAV bool `json:"webdav"`
	S3     bool `json:"s3"`
}

type cloudBackupPolicy struct {
	ScheduleEnabled   bool   `json:"scheduleEnabled"`
	ScheduleFrequency string `json:"scheduleFrequency"`
	ScheduleTime      string `json:"scheduleTime"`
	ScheduleWeekday   string `json:"scheduleWeekday"`
	Retention         int    `json:"retention"`
}

type cloudBackupPolicyState struct {
	WebDAV cloudBackupPolicy `json:"webdav"`
	S3     cloudBackupPolicy `json:"s3"`
}

type cloudBackupTargetStatus struct {
	LastBackupAt *string `json:"lastBackupAt"`
	LastStatus   string  `json:"lastStatus"`
	LastError    *string `json:"lastError"`
	UpdatedAt    *string `json:"updatedAt"`
}

type cloudBackupStatusState struct {
	WebDAV cloudBackupTargetStatus `json:"webdav"`
	S3     cloudBackupTargetStatus `json:"s3"`
}

type cloudBackupResolvedConfig struct {
	UserID    string
	Provider  string
	Targets   map[string]cloudBackupResolvedTarget
	UpdatedAt string
}

type cloudBackupResolvedTarget struct {
	Record       *core.Record
	UserID       string
	Provider     string
	WebDAV       *cloudBackupWebDAVSettings
	S3           *cloudBackupS3Settings
	Credential   cloudBackupStoredCredential
	Policy       cloudBackupPolicy
	LastBackupAt string
	LastStatus   string
	LastError    string
	LockedUntil  string
	UpdatedAt    string
}

type cloudBackupSnapshotDTO struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Provider  string `json:"provider"`
	CreatedAt string `json:"createdAt"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
}

type cloudBackupSnapshotManifest struct {
	Kind                string `json:"kind"`
	SchemaVersion       int    `json:"schemaVersion"`
	ID                  string `json:"id"`
	Filename            string `json:"filename"`
	CreatedAt           string `json:"createdAt"`
	SizeBytes           int64  `json:"sizeBytes"`
	SHA256              string `json:"sha256"`
	ExportKind          string `json:"exportKind"`
	ExportSchemaVersion int    `json:"exportSchemaVersion"`
}

type cloudBackupSnapshotPayload struct {
	Content  []byte
	ID       string
	Filename string
	Manifest cloudBackupSnapshotManifest
}

type cloudBackupRemoteClient interface {
	Test(ctx context.Context) error
	List(ctx context.Context) ([]cloudBackupSnapshotManifest, error)
	Upload(ctx context.Context, filename string, content []byte, manifest cloudBackupSnapshotManifest) error
	Download(ctx context.Context, id string) ([]byte, cloudBackupSnapshotManifest, error)
	Delete(ctx context.Context, id string) error
}

type cloudBackupTarget struct {
	Provider  string
	Client    cloudBackupRemoteClient
	Retention int
}
