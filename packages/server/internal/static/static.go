package static

import "embed"

// Files 包含 Vite 构建产物；Docker 构建时会在编译 Go 二进制前，
// 用 packages/client/dist 替换这个目录。
//
//go:embed all:public
var Files embed.FS

//go:embed data/built-in-icons-index.json
var BuiltInIconsIndex []byte

//go:embed data/media-resolver-config.json
var MediaResolverConfig []byte
