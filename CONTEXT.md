# FormulaBridge

FormulaBridge 的领域语言描述由 LaTeX 驱动、在 Microsoft Word 中管理和呈现的公式，以及它们使用的本地 TeX 配置。

## 产品边界

**首要用户**：
已经安装 TeX，并使用现代 Windows Word 撰写论文或技术文档的个人科研用户。
_Avoid_：同时把企业管理员、Aurora 迁移用户称为首要用户

**FormulaBridge 1.0**：
可以正式使用的核心版本，不是技术预览，也不等于完整产品愿景中的全部功能。
_Avoid_：完整版本、技术预览

## 公式

**FormulaBridge 公式**：
由稳定标识和权威 LaTeX 源码定义、由 FormulaBridge 管理的 Word 文档对象。
_Avoid_：OLE 公式、图片公式、普通 Word 公式

**LaTeX 源码**：
FormulaBridge 公式的权威语义来源；OMML、SVG 和 PNG 都是由它生成的表示。
_Avoid_：把可见 Word 内容与 LaTeX 源码同时称为事实来源

**可见表示**：
FormulaBridge 公式在 Word 中显示的 OMML，或由本地 TeX 生成并嵌入的 SVG 与 PNG；它是 LaTeX 源码的派生投影。
_Avoid_：最终源码、事实来源

## TeX 配置

**TeX 安装**：
本机实际存在的一套 TeX Live、MiKTeX 或便携式 TeX 发行版及其版本和根目录。
_Avoid_：TeX 环境

**渲染配置**：
一个 TeX 安装、一个引擎、转换器、preamble 和安全策略的明确组合。
_Avoid_：引擎环境、环境配置、TeX 环境

**文档环境要求**：
Word 文档声明的引擎、宏包和渲染能力要求，不包含任何本机绝对路径。
_Avoid_：文档 TeX 路径、文档环境

**公式覆盖配置**：
单个 FormulaBridge 公式对文档默认渲染配置的显式覆盖。
_Avoid_：单公式环境、临时环境

## 信任边界

**文档 TeX 输入**：
从 Word 文档读取的 LaTeX 源码，一律视为不可信输入；FormulaBridge 不自动编译，只有用户明确触发时才在受限 RenderHost 中处理。
_Avoid_：可信文档公式
