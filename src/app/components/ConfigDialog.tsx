"use client";
// TODO  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82V0dwTWJ3PT06YjYzMjUxZjE=

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StandaloneConfig } from "@/lib/config";
// NOTE  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82V0dwTWJ3PT06YjYzMjUxZjE=

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: StandaloneConfig) => void;
  initialConfig?: StandaloneConfig;
}
// eslint-disable  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82V0dwTWJ3PT06YjYzMjUxZjE=

export function ConfigDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: ConfigDialogProps) {
  const [deploymentUrl, setDeploymentUrl] = useState(
    initialConfig?.deploymentUrl || ""
  );
  const [assistantId, setAssistantId] = useState(
    initialConfig?.assistantId || ""
  );
  const [langsmithApiKey, setLangsmithApiKey] = useState(
    initialConfig?.langsmithApiKey || ""
  );

  useEffect(() => {
    if (open && initialConfig) {
      // `|| ""`：首次配置时这些字段可能是 undefined，直接塞进受控 input 会让 React
      // 从非受控变受控（控制台警告 + 输入行为异常）
      setDeploymentUrl(initialConfig.deploymentUrl || "");
      setAssistantId(initialConfig.assistantId || "");
      setLangsmithApiKey(initialConfig.langsmithApiKey || "");
    }
  }, [open, initialConfig]);

  const handleSave = () => {
    // 部署 URL **允许留空**（2026-09-25）：留空 = 跟随当前访问地址
    // （`window.location.origin`，见 lib/deploymentUrl.ts）—— 页面从哪个入口发下来就用哪个，
    // 换域名/端口/https 都不用改配置。原来强制必填，而各处又兜底 localhost:2026，
    // 对别人的浏览器指向用户自己的机器（「模型都没了 + Failed to fetch」）。
    if (!assistantId) {
      alert("请填写助手 ID");
      return;
    }

    onSave({
      deploymentUrl,
      assistantId,
      langsmithApiKey: langsmithApiKey || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>配置</DialogTitle>
          <DialogDescription>
            配置您的 智能体 部署设置。这些设置将保存在浏览器的本地存储中。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="deploymentUrl">
              部署 URL{" "}
              <span className="text-muted-foreground">(留空 = 跟随当前访问地址)</span>
            </Label>
            <Input
              id="deploymentUrl"
              placeholder="留空 = 跟随当前访问地址"
              value={deploymentUrl}
              onChange={(e) => setDeploymentUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assistantId">助手 ID</Label>
            <Input
              id="assistantId"
              placeholder="<助手ID>"
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
            />
          </div>
          {/*<div className="grid gap-2">*/}
          {/*  <Label htmlFor="langsmithApiKey">*/}
          {/*    LangSmith API 密钥{" "}*/}
          {/*    <span className="text-muted-foreground">(可选)</span>*/}
          {/*  </Label>*/}
          {/*  <Input*/}
          {/*    id="langsmithApiKey"*/}
          {/*    type="password"*/}
          {/*    placeholder="lsv2_pt_..."*/}
          {/*    value={langsmithApiKey}*/}
          {/*    onChange={(e) => setLangsmithApiKey(e.target.value)}*/}
          {/*  />*/}
          {/*</div>*/}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// NOTE  My80OmFIVnBZMlhrdUp2bG43bmx2TG82V0dwTWJ3PT06YjYzMjUxZjE=
