; Native controls only. MUI2 and nsDialogs work on Windows 7 SP1.
!define MUI_TEXTCOLOR "24252A"
!define MUI_BGCOLOR "F0F0F0"
!define MUI_HEADER_TEXT_COLOR "24252A"
!define MUI_HEADER_BGCOLOR "FFFFFF"
!define MUI_ABORTWARNING

!ifdef MUI_HEADERIMAGE
  !undef MUI_HEADERIMAGE
!endif
!include "MUI2.nsh"
!include "nsDialogs.nsh"
SetFont "Microsoft YaHei" 9

Var NativeDialog
Var NativeLabel
Var NativeTitleFont

!macro NativeTitle TEXT
  ${NSD_CreateLabel} 0 12u 100% 32u "${TEXT}"
  Pop $NativeLabel
  CreateFont $NativeTitleFont "Microsoft YaHei" 18 600
  SendMessage $NativeLabel ${WM_SETFONT} $NativeTitleFont 1
  SetCtlColors $NativeLabel "C93349" "F0F0F0"
!macroend

!ifndef BUILD_UNINSTALLER

Var NativeRunCheckbox

!macro customWelcomePage
  Page custom NativeWelcomeCreate
!macroend

Function NativeWelcomeCreate
  !insertmacro MUI_HEADER_TEXT "茗韵时光 ${VERSION}" "Windows 桌面播放器"
  nsDialogs::Create 1018
  Pop $NativeDialog
  ${If} $NativeDialog == error
    Abort
  ${EndIf}
  SetCtlColors $NativeDialog "24252A" "F0F0F0"
  !insertmacro NativeTitle "欢迎安装茗韵时光"
  ${NSD_CreateLabel} 0 56u 100% 42u "安装向导将帮助你选择安装范围与存放目录。$\r$\n点击「下一步」继续。"
  Pop $NativeLabel
  ${NSD_CreateLabel} 0 114u 100% 36u "Windows 7 SP1 / 8.1 / 10 / 11 · 64 位$\r$\n安装包包含全部程序文件，安装过程无需联网。"
  Pop $NativeLabel
  SetCtlColors $NativeLabel "70717A" "F0F0F0"
  nsDialogs::Show
FunctionEnd

!macro customFinishPage
  Page custom NativeFinishCreate NativeFinishLeave

Function NativeFinishCreate
  !insertmacro MUI_HEADER_TEXT "安装完成" "茗韵时光已准备就绪"
  nsDialogs::Create 1018
  Pop $NativeDialog
  ${If} $NativeDialog == error
    Abort
  ${EndIf}
  SetCtlColors $NativeDialog "24252A" "F0F0F0"
  !insertmacro NativeTitle "开始你的音乐时光"
  ${NSD_CreateLabel} 0 56u 100% 36u "程序已安装到：$\r$\n$INSTDIR"
  Pop $NativeLabel
  ${NSD_CreateCheckbox} 0 108u 100% 16u "立即启动茗韵时光"
  Pop $NativeRunCheckbox
  ${NSD_Check} $NativeRunCheckbox
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

Function NativeFinishLeave
  ${NSD_GetState} $NativeRunCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  ${EndIf}
FunctionEnd
!macroend

!macro customInit
  ; Keep the existing destination when upgrading.
  ${If} $installMode == "all"
    ${If} $perMachineInstallationFolder == ""
      StrCpy $INSTDIR "$PROGRAMFILES\MingYunTime"
    ${EndIf}
  ${Else}
    ${If} $perUserInstallationFolder == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\MingYunTime"
    ${EndIf}
  ${EndIf}
!macroend

!else

!macro customUnWelcomePage
  UninstPage custom un.NativeWelcomeCreate
!macroend

Function un.NativeWelcomeCreate
  !insertmacro MUI_HEADER_TEXT "卸载茗韵时光" "账户与个人设置将保留"
  nsDialogs::Create 1018
  Pop $NativeDialog
  ${If} $NativeDialog == error
    Abort
  ${EndIf}
  SetCtlColors $NativeDialog "24252A" "F0F0F0"
  !insertmacro NativeTitle "卸载茗韵时光"
  ${NSD_CreateLabel} 0 56u 100% 54u "此向导将移除程序文件与快捷方式。$\r$\n账户、歌单与个人设置将保留。$\r$\n点击「下一步」继续。"
  Pop $NativeLabel
  nsDialogs::Show
FunctionEnd

; Replace the finish page inserted directly by electron-builder.
!macroundef MUI_UNPAGE_FINISH
!macro MUI_UNPAGE_FINISH
  UninstPage custom un.NativeFinishCreate
!macroend

Function un.NativeFinishCreate
  !insertmacro MUI_HEADER_TEXT "卸载完成" "谢谢使用茗韵时光"
  nsDialogs::Create 1018
  Pop $NativeDialog
  ${If} $NativeDialog == error
    Abort
  ${EndIf}
  SetCtlColors $NativeDialog "24252A" "F0F0F0"
  !insertmacro NativeTitle "程序已卸载"
  ${NSD_CreateLabel} 0 56u 100% 36u "程序文件与快捷方式已移除。$\r$\n个人设置已保留，重新安装后可继续使用。"
  Pop $NativeLabel
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

!endif
