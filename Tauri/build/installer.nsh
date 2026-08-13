; 茗韵时光 NSIS 安装程序自定义脚本
; 功能：
;   1. 默认安装到 D:\MingYunTime（multiUser.nsh 已修改 setInstallModePerUser/PerAllUsers）
;   2. 用户选择盘符根目录时，自动追加 MingYunTime 文件夹
;   3. 添加欢迎页（显示侧边栏品牌图）
;   4. MUI 界面美化（红白配色，与程序风格一致）

; === MUI 颜色定义（在 MUI2.nsh 之前定义，MUI_DEFAULT 不会覆盖）===
!define MUI_TEXTCOLOR "3C3C3C"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_HEADER_TEXT_COLOR "C41E3A"
!define MUI_HEADER_BGCOLOR "FFFFFF"

!ifndef BUILD_UNINSTALLER

; === 欢迎页（默认模板不包含欢迎页，需通过 customWelcomePage 添加）===
!macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "茗韵时光 安装向导"
    !define MUI_WELCOMEPAGE_TEXT "欢迎使用茗韵时光安装向导。$\r$\n$\r$\n点击「下一步」继续，或点击「取消」退出安装。$\r$\n$\r$\n茗韵时光 - 让音乐陪伴每一刻"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomePageShow
    !insertmacro MUI_PAGE_WELCOME
!macroend

; === 欢迎页显示时美化按钮和背景 ===
Function WelcomePageShow
    Call StyleWindow
    Call StyleButtons
FunctionEnd

; === 目录页前置钩子：只设置 SHOW 函数美化界面（不覆盖 PRE，避免 skipPageIfUpdated 警告）===
!macro customDirectoryPre
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DirectoryPageShow
!macroend

; 目录页显示时美化
Function DirectoryPageShow
    Call StyleWindow
    Call StyleButtons
FunctionEnd

; === 美化整个窗口：白色背景 ===
Function StyleWindow
    Push $0
    ; 设置主窗口标题颜色
    GetDlgItem $0 $HWNDPARENT 1037
    SetCtlColors $0 "C41E3A" "FFFFFF"
    GetDlgItem $0 $HWNDPARENT 1038
    SetCtlColors $0 "3C3C3C" "FFFFFF"
    ; 设置底部背景为白色
    GetDlgItem $0 $HWNDPARENT 1028
    SetCtlColors $0 "3C3C3C" "FFFFFF"
    Pop $0
FunctionEnd

; === 美化窗口按钮：红色"下一步"按钮 ===
Function StyleButtons
    Push $0
    ; 下一步按钮 (ID=1)：网易云红
    GetDlgItem $0 $HWNDPARENT 1
    SetCtlColors $0 "C41E3A" "FFFFFF"
    ; 取消按钮 (ID=2)：深灰
    GetDlgItem $0 $HWNDPARENT 2
    SetCtlColors $0 "3C3C3C" "FFFFFF"
    ; 上一步按钮 (ID=3)：深灰
    GetDlgItem $0 $HWNDPARENT 3
    SetCtlColors $0 "3C3C3C" "FFFFFF"
    Pop $0
FunctionEnd

; === customInit：在 onInit 中设置默认路径（双保险）===
!macro customInit
    StrCpy $INSTDIR "D:\MingYunTime"
!macroend

; === 目录选择验证：自动追加 MingYunTime 文件夹 ===
; 用户选择任意盘符根目录（如 E:\）都会自动变成 E:\MingYunTime
Function .onVerifyInstDir
    Push $0
    Push $1
    Push $2

    StrCpy $0 "$INSTDIR"

    ; 去除末尾的反斜杠
    StrCpy $1 $0 1 -1
    StrCmp $1 "\" 0 +2
    StrCpy $0 $0 -1

    ; 检查路径长度是否 >= 13（"X:\MingYunTime" 最短13字符）
    StrLen $1 $0
    IntCmp $1 13 0 append 0

    ; 长度 >= 13，取最后12个字符检查是否为 \MingYunTime
    StrCpy $2 $0 "" -12
    StrCmp $2 "\MingYunTime" done append

    append:
    StrCpy $INSTDIR "$0\MingYunTime"

    done:
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

!endif
