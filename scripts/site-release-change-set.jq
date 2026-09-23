# Accepts a describe-change-set summary (Changes[].ResourceChange as {Action, Id, Replacement,
# Details[]{Source, Evaluation, Cause, Name}}) only when it is a pure injoffice.com release
# switch: the distribution modified in place because ReleaseId moved, plus at most the apex
# A/AAAA aliases that CloudFormation re-checks at run time because they point at the
# distribution's (unchanging) domain name. Anything else evaluates to false.
length > 0
and all(.[]; .Action == "Modify" and .Replacement == "False")
and ([.[] | select(.Id == "Distribution")] | length) == 1
and ([.[] | select(.Id == "Distribution") | .Details[] | select(.Source == "ParameterReference" and .Cause == "ReleaseId")] | length) == 1
and all(.[] | select(.Id == "Distribution") | .Details[];
        (.Source == "ParameterReference" and .Cause == "ReleaseId")
        or (.Source == "DirectModification" and .Evaluation == "Dynamic"))
and all(.[] | select(.Id != "Distribution");
        (.Id == "DomainIPv4" or .Id == "DomainIPv6")
        and (.Details | length) > 0
        and all(.Details[]; .Source == "ResourceAttribute" and .Evaluation == "Dynamic"
                            and .Cause == "Distribution.DomainName" and .Name == "AliasTarget"))
