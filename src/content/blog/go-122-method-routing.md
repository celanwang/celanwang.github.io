---
title: Go 1.22 方法级路由：标准库终于原生支持 RESTful
description: 介绍 Go 1.22 的 ServeMux 方法级路由，包括按 HTTP 方法和路径注册处理器、自动处理 405 与 Allow 响应头，以及用 PathValue 读取路径参数。
pubDate: 2026-04-06
tags: [Go, 后端, 标准库]
featured: false
---

## 旧版本的痛点（Go 1.22 之前）

Go 1.22 之前，`ServeMux` 只能根据**路径**匹配路由，无法区分 HTTP 方法。实现「同一路径、不同方法对应不同逻辑」必须在 handler 内手动判断：

```go
func userHandler(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        fmt.Fprintf(w, "获取用户信息")
    case http.MethodPost:
        fmt.Fprintf(w, "创建用户")
    default:
        w.Header().Set("Allow", "GET, POST")
        http.Error(w, "不支持的请求方法", http.StatusMethodNotAllowed)
    }
}
```

这段代码的问题很明显：职责不单一、405 和 Allow 头要手动处理、方法多了之后 switch 越来越臃肿。

## 新版本核心特性

Go 1.22 扩展了 `ServeMux` 的路由匹配规则，支持 `METHOD /path` 格式：

- **路由注册格式**：`[大写 HTTP 方法] [路径]`，如 `GET /user`、`DELETE /user/:id`
- **匹配优先级**：方法+路径路由优先级高于普通路径路由
- **自动错误处理**：未匹配方法自动返回 `405 Method Not Allowed`，并附带 `Allow` 响应头
- **兼容路径参数**：结合 `r.PathValue()` 获取动态参数

直接看代码：

```go
func getUserHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "GET /user：获取所有用户信息")
}

func postUserHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "POST /user：创建新用户")
}

func getUserByIdHandler(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    fmt.Fprintf(w, "GET /user/%s：获取用户信息", id)
}

func main() {
    http.HandleFunc("GET /user", getUserHandler)
    http.HandleFunc("POST /user", postUserHandler)
    http.HandleFunc("GET /user/:id", getUserByIdHandler)
    http.ListenAndServe(":8080", nil)
}
```

关键点：

- `http.HandleFunc("GET /user", ...)` 直接注册方法+路径的处理器
- `r.PathValue("id")` 获取路径中 `:id` 占位符的值
- 请求 `PUT /user` 自动返回 `405`，响应头包含 `Allow: GET,POST`

## 验证

```bash
# GET /user
curl http://localhost:8080/user
# → GET /user：获取所有用户信息

# POST /user
curl -X POST http://localhost:8080/user
# → POST /user：创建新用户

# GET /user/123
curl http://localhost:8080/user/123
# → GET /user/123：获取用户信息

# PUT /user（未注册的方法）
curl -X PUT http://localhost:8080/user
# → 405 Method Not Allowed
```

## 总结

Go 1.22 的 `ServeMux` 原生支持方法级路由，三个核心收益：

1. handler 职责单一，一个方法一个函数，代码更清晰
2. 405 和 Allow 头自动处理，省去样板代码
3. 结合 `r.PathValue()` 可优雅实现 RESTful API，大幅减少对第三方路由库的依赖

对于新项目来说，标准库的路由能力已经够用了。
