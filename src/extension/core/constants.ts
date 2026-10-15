// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).

export const NoEnvironmentSelectedName: string = 'c0cfe680-4fcd-4b71-a4ba-8cfaee57680a';
export const SharedEnvironmentName = '$shared';

export const TimeStampVariableName = "$timestamp";
export const DateTimeVariableName = "$datetime";
export const LocalDateTimeVariableName = "$localDatetime";
export const GuidVariableName = "$guid";
export const RandomIntVariableName = "$randomInt";
export const ProcessEnvVariableName = "$processEnv";
export const DotenvVariableName = "$dotenv";
export const AzureActiveDirectoryVariableName = "$aadToken";
export const AzureActiveDirectoryV2TokenVariableName = "$aadV2Token";
export const OidcVariableName = "$oidcAccessToken";

export const AzureClouds: { [key: string]: { aad: string, arm: string, armAudience?: string } } = {
    // default cloud must be first
    public: {
        aad: "https://login.microsoftonline.com/",
        arm: "https://management.azure.com/",
    },
    cn: {
        aad: "https://login.chinacloudapi.cn/",
        arm: "https://management.chinacloudapi.cn/",
    },
    de: {
        aad: "https://login.microsoftonline.de/",
        arm: "https://management.microsoftazure.de/",
    },
    us: {
        aad: "https://login.microsoftonline.us/",
        arm: "https://management.usgovcloudapi.net/",
    },
    ppe: {
        aad: "https://login.windows-ppe.net/",  // for testing purposes only
        arm: "https://api-dogfood.resources.windows-int.net/",
        armAudience: "https://management.azure.com/",
    },
};

export const RequestMetadataRegex: RegExp = /^\s*(?:#|\/{2})\s*@([\w-]+)(?:\s+(.*?))?\s*$/;

export const CommentIdentifiersRegex: RegExp = /^\s*(#|\/{2})/;

export const FileVariableDefinitionRegex: RegExp = /^\s*@([^\s=]+)\s*=\s*(.*?)\s*$/;

export const RequestVariableDefinitionWithNameRegexFactory = (name: string, flags?: string): RegExp =>
    new RegExp(`^\\s*(?:#{1,}|\\/{2,})\\s+@name\\s+(${name})\\s*$`, flags);

export const RequestVariableDefinitionRegex: RegExp = RequestVariableDefinitionWithNameRegexFactory("\\w+", "m");

export const PromptCommentRegex = /^\s*(?:#{1,}|\/{2,})\s*@prompt\s+([^\s]+)(?:\s+(.*))?\s*$/;

export const LineSplitterRegex: RegExp = /\r?\n/g;

export const DelimiterRegex: RegExp = /^#{3,}/;

export const ResponseStatusLineRegex: RegExp = /^\s*HTTP\/[\d.]+/;

export const HttpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'LOCK', 'UNLOCK', 'PROPFIND', 'PROPPATCH', 'COPY', 'MOVE', 'MKCOL', 'MKCALENDAR', 'ACL', 'SEARCH'];
